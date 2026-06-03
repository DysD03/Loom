import "server-only";

import { randomUUID } from "node:crypto";
import { embed, embedMany } from "ai";
import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import {
  documentChunks,
  documents,
  type Document,
  type DocumentChunk,
} from "@/db/schema";
import { getEmbeddingModel } from "./provider";
import { detectKind, extractText } from "./extract";

const CHUNK_SIZE = 1_000;
const CHUNK_OVERLAP = 150;
const EMBED_BATCH = 64;
const RETRIEVAL_FLOOR = 0.25;
const RETRIEVAL_LIMIT = 6;
const CHUNK_PREVIEW = 1_200;

export function listDocuments(): Document[] {
  return db.select().from(documents).orderBy(desc(documents.createdAt)).all();
}

export function getDocument(id: string): Document | undefined {
  return db.select().from(documents).where(eq(documents.id, id)).get();
}

export function deleteDocument(id: string): void {
  // document_chunks cascade on delete.
  db.delete(documents).where(eq(documents.id, id)).run();
}

export function renameDocument(id: string, title: string): Document | undefined {
  return db
    .update(documents)
    .set({ title, updatedAt: new Date().toISOString() })
    .where(eq(documents.id, id))
    .returning()
    .get();
}

/**
 * Splits text into overlapping chunks near `CHUNK_SIZE`, breaking on paragraph
 * boundaries where possible so chunks stay semantically coherent. The overlap
 * preserves context across boundaries for better retrieval.
 */
export function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) {
      chunks.push(trimmed);
    }
    // Carry the tail of the chunk forward as overlap.
    current = trimmed.length > CHUNK_OVERLAP ? trimmed.slice(-CHUNK_OVERLAP) : "";
  };

  for (const para of paragraphs) {
    // A single oversized paragraph is hard-split by length.
    if (para.length > CHUNK_SIZE) {
      flush();
      for (let i = 0; i < para.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        chunks.push(para.slice(i, i + CHUNK_SIZE).trim());
      }
      current = "";
      continue;
    }
    if (current && current.length + para.length + 2 > CHUNK_SIZE) {
      flush();
    }
    current = current ? `${current}\n\n${para}` : para;
  }
  flush();

  return chunks.filter(Boolean);
}

async function embedChunks(texts: string[]): Promise<(number[] | null)[]> {
  const embedder = getEmbeddingModel();
  if (!embedder) {
    return texts.map(() => null);
  }
  const out: (number[] | null)[] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const { embeddings } = await embedMany({ model: embedder.model, values: batch });
    out.push(...embeddings);
  }
  return out;
}

/**
 * Parses an uploaded file, chunks + embeds it, and stores the document with its
 * chunks. Creates the document row up front (status "processing") so a slow
 * embed pass is visible in the UI; flips to "ready" or "error" at the end.
 */
export async function ingestDocument(input: {
  title: string;
  filename: string;
  mimeType: string;
  buffer: ArrayBuffer;
}): Promise<Document> {
  const kind = detectKind(input.filename, input.mimeType);
  const id = randomUUID();

  // Insert up front (status "processing") so a slow embed pass is visible in the UI.
  db.insert(documents)
    .values({
      id,
      title: input.title.trim() || input.filename || "Untitled document",
      filename: input.filename,
      kind,
      sizeBytes: input.buffer.byteLength,
      status: "processing",
    })
    .run();

  try {
    const text = await extractText(input.buffer, kind);
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      throw new Error("No extractable text found in the file.");
    }
    const embeddings = await embedChunks(chunks);

    db.insert(documentChunks)
      .values(
        chunks.map((content, i) => ({
          id: randomUUID(),
          documentId: id,
          chunkIndex: i,
          content,
          embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
        })),
      )
      .run();

    return db
      .update(documents)
      .set({
        status: "ready",
        charCount: text.length,
        chunkCount: chunks.length,
        error: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(documents.id, id))
      .returning()
      .get();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to process document.";
    return db
      .update(documents)
      .set({ status: "error", error: message, updatedAt: new Date().toISOString() })
      .where(eq(documents.id, id))
      .returning()
      .get();
  }
}

function parseEmbedding(value: string | null): number[] | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as number[]) : null;
  } catch {
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface RetrievedChunk {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  score: number;
}

function readyChunks(): (DocumentChunk & { docTitle: string })[] {
  const readyDocs = db
    .select()
    .from(documents)
    .where(eq(documents.status, "ready"))
    .all();
  if (readyDocs.length === 0) {
    return [];
  }
  const titleById = new Map(readyDocs.map((d) => [d.id, d.title]));
  const rows = db
    .select()
    .from(documentChunks)
    .where(inArray(documentChunks.documentId, [...titleById.keys()]))
    .all();
  return rows.map((r) => ({ ...r, docTitle: titleById.get(r.documentId) ?? "" }));
}

/**
 * Retrieves the most relevant document chunks for a query via cosine similarity.
 * Returns [] when there are no documents, no query, or no embeddings model.
 */
export async function retrieveRelevantChunks(
  query: string,
  limit = RETRIEVAL_LIMIT,
): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const embedder = getEmbeddingModel();
  if (!embedder) {
    return [];
  }
  const chunks = readyChunks();
  if (chunks.length === 0) {
    return [];
  }

  const { embedding: queryEmbedding } = await embed({
    model: embedder.model,
    value: trimmed,
  });

  return chunks
    .map((c) => {
      const embedding = parseEmbedding(c.embedding);
      return {
        documentId: c.documentId,
        documentTitle: c.docTitle,
        chunkIndex: c.chunkIndex,
        content: c.content,
        score: embedding ? cosineSimilarity(queryEmbedding, embedding) : 0,
      };
    })
    .filter((c) => c.score >= RETRIEVAL_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Formats retrieved chunks as a system-prompt block with source citations. */
export function formatChunksForPrompt(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return "";
  }
  const blocks = chunks
    .map(
      (c, i) =>
        `[${i + 1}] from "${c.documentTitle}":\n${c.content.slice(0, CHUNK_PREVIEW)}`,
    )
    .join("\n\n");
  return (
    "Relevant excerpts from the user's uploaded documents. " +
    "Use them to answer when applicable, and cite the source document by name:\n\n" +
    blocks
  );
}

/** Backing function for the `searchDocuments` tool. */
export async function searchDocuments(
  query: string,
  limit = RETRIEVAL_LIMIT,
): Promise<
  { results: { document: string; excerpt: string; score: number }[] } | { error: string }
> {
  const embedder = getEmbeddingModel();
  if (!embedder) {
    return { error: "No embeddings model configured (Settings → Embeddings model)." };
  }
  const chunks = await retrieveRelevantChunks(query, limit);
  return {
    results: chunks.map((c) => ({
      document: c.documentTitle,
      excerpt: c.content.slice(0, CHUNK_PREVIEW),
      score: Number(c.score.toFixed(3)),
    })),
  };
}
