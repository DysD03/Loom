import "server-only";

import { randomUUID } from "node:crypto";
import { embed, embedMany } from "ai";
import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { documentChunks, documents, type Document } from "@/db/schema";
import { getEmbeddingModel } from "./provider";
import { detectKind, extractText } from "./extract";
import { indexChunkVectors, removeChunkVectors, searchChunkVectors } from "./vec";
import { cosineSimilarity, parseVector } from "./vectors";
import { fetchReadable } from "./web";

const CHUNK_SIZE = 1_000;
const CHUNK_OVERLAP = 150;
const EMBED_BATCH = 64;
const RETRIEVAL_FLOOR = 0.25;
const RETRIEVAL_LIMIT = 6;
const CHUNK_PREVIEW = 1_200;

export function listDocuments(): Document[] {
  return db.select().from(documents).orderBy(desc(documents.createdAt)).all();
}

/** Documents uploaded as files (excludes Editor-authored mirrors). */
export function listUploadedDocuments(): Document[] {
  return db
    .select()
    .from(documents)
    .where(eq(documents.source, "upload"))
    .orderBy(desc(documents.createdAt))
    .all();
}

export function getDocument(id: string): Document | undefined {
  return db.select().from(documents).where(eq(documents.id, id)).get();
}

export function deleteDocument(id: string): void {
  const chunkIds = db
    .select({ id: documentChunks.id })
    .from(documentChunks)
    .where(eq(documentChunks.documentId, id))
    .all()
    .map((r) => r.id);
  // document_chunks cascade on delete; the vec index has no FK, so clean it up.
  db.delete(documents).where(eq(documents.id, id)).run();
  removeChunkVectors(chunkIds);
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
 * Chunks + embeds `text` and stores the chunks against an already-inserted
 * document row, flipping its status to "ready". Throws if there is no text;
 * the caller is responsible for recording the error on the row.
 */
async function finalizeIngest(id: string, text: string): Promise<Document> {
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new Error("No extractable text found.");
  }
  const embeddings = await embedChunks(chunks);

  const rows = chunks.map((content, i) => ({
    id: randomUUID(),
    documentId: id,
    chunkIndex: i,
    content,
    embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
  }));
  db.insert(documentChunks).values(rows).run();

  indexChunkVectors(
    rows.flatMap((row, i) => {
      const embedding = embeddings[i];
      return embedding ? [{ id: row.id, embedding }] : [];
    }),
  );

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
}

function failIngest(id: string, err: unknown): Document {
  const message = err instanceof Error ? err.message : "Failed to process document.";
  return db
    .update(documents)
    .set({ status: "error", error: message, updatedAt: new Date().toISOString() })
    .where(eq(documents.id, id))
    .returning()
    .get();
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
      source: "upload",
      sizeBytes: input.buffer.byteLength,
      status: "processing",
    })
    .run();

  try {
    const text = await extractText(input.buffer, kind);
    return await finalizeIngest(id, text);
  } catch (err) {
    return failIngest(id, err);
  }
}

/**
 * Ingests raw text (no file parsing) into the knowledge base — used to mirror
 * Editor documents into RAG. Returns the created document row.
 */
export async function ingestTextDocument(input: {
  title: string;
  text: string;
  source?: "upload" | "editor";
  kind?: string;
  filename?: string;
}): Promise<Document> {
  const id = randomUUID();
  const title = input.title.trim() || "Untitled document";
  db.insert(documents)
    .values({
      id,
      title,
      filename: input.filename ?? `${title}.md`,
      kind: input.kind ?? "markdown",
      source: input.source ?? "editor",
      sizeBytes: Buffer.byteLength(input.text, "utf8"),
      status: "processing",
    })
    .run();

  try {
    return await finalizeIngest(id, input.text);
  } catch (err) {
    return failIngest(id, err);
  }
}

/** How much readable page text a URL ingest keeps (well past any article's length). */
const URL_MAX_CHARS = 200_000;

/**
 * Fetches a web page, strips it to readable text, and ingests it into the
 * knowledge base like an uploaded file. Throws (before creating any row) when
 * the page can't be fetched or has no readable text.
 */
export async function ingestUrlDocument(url: string): Promise<Document> {
  const page = await fetchReadable(url, URL_MAX_CHARS);
  if (page.error) {
    throw new Error(page.error);
  }
  const text = page.text?.trim();
  if (!text) {
    throw new Error("No readable text found at that URL.");
  }
  return ingestTextDocument({
    title: page.title?.trim() || url,
    text,
    source: "upload",
    kind: "url",
    filename: url,
  });
}

export interface RetrievedChunk {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  score: number;
}

interface CorpusChunk {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  vector: Float32Array | null;
}

// Chunk rows are immutable once a document is "ready", so the parsed corpus is
// cached per document (keyed on `updatedAt` to catch renames/re-ingests). This
// avoids re-reading and re-JSON.parsing every embedding on every chat message.
const corpusCache = new Map<string, { stamp: string; chunks: CorpusChunk[] }>();

function readyCorpus(): CorpusChunk[] {
  const readyDocs = db
    .select({ id: documents.id, title: documents.title, updatedAt: documents.updatedAt })
    .from(documents)
    .where(eq(documents.status, "ready"))
    .all();

  // Drop cache entries for documents that no longer exist (or aren't ready).
  const liveIds = new Set(readyDocs.map((d) => d.id));
  for (const id of corpusCache.keys()) {
    if (!liveIds.has(id)) {
      corpusCache.delete(id);
    }
  }

  const out: CorpusChunk[] = [];
  for (const doc of readyDocs) {
    let entry = corpusCache.get(doc.id);
    if (!entry || entry.stamp !== doc.updatedAt) {
      const rows = db
        .select()
        .from(documentChunks)
        .where(eq(documentChunks.documentId, doc.id))
        .all();
      entry = {
        stamp: doc.updatedAt,
        chunks: rows.map((r) => ({
          documentId: doc.id,
          documentTitle: doc.title,
          chunkIndex: r.chunkIndex,
          content: r.content,
          vector: parseVector(r.embedding),
        })),
      };
      corpusCache.set(doc.id, entry);
    }
    out.push(...entry.chunks);
  }
  return out;
}

/** Cheap existence check so callers can skip query embedding when there is nothing to retrieve. */
export function hasReadyDocuments(): boolean {
  return (
    db.select({ id: documents.id }).from(documents).where(eq(documents.status, "ready")).get() !==
    undefined
  );
}

/**
 * Retrieves the most relevant document chunks for a query via cosine similarity.
 * Returns [] when there are no documents, no query, or no embeddings model.
 * Pass `queryEmbedding` when the caller already embedded the query (e.g. to share
 * one embedding call across memory + document retrieval); `undefined` embeds here.
 */
export async function retrieveRelevantChunks(
  query: string,
  limit = RETRIEVAL_LIMIT,
  queryEmbedding?: number[] | null,
): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (!trimmed || queryEmbedding === null) {
    return [];
  }
  if (!hasReadyDocuments()) {
    return [];
  }

  let resolved = queryEmbedding;
  if (resolved === undefined) {
    const embedder = getEmbeddingModel();
    if (!embedder) {
      return [];
    }
    ({ embedding: resolved } = await embed({ model: embedder.model, value: trimmed }));
  }

  // sqlite-vec KNN when the extension is available; in-process cosine otherwise.
  const vecHits = searchChunkVectors(resolved, limit);
  if (vecHits) {
    return hydrateVecHits(vecHits);
  }

  return scoreChunks(readyCorpus(), resolved, limit);
}

/** Joins vec KNN hits back to chunk content + document titles, keeping score order. */
function hydrateVecHits(hits: { id: string; score: number }[]): RetrievedChunk[] {
  const passing = hits.filter((h) => h.score >= RETRIEVAL_FLOOR);
  if (passing.length === 0) {
    return [];
  }
  const rows = db
    .select({
      id: documentChunks.id,
      documentId: documentChunks.documentId,
      chunkIndex: documentChunks.chunkIndex,
      content: documentChunks.content,
      documentTitle: documents.title,
      status: documents.status,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documentChunks.documentId, documents.id))
    .where(
      inArray(
        documentChunks.id,
        passing.map((h) => h.id),
      ),
    )
    .all();
  const byId = new Map(rows.map((r) => [r.id, r]));

  const out: RetrievedChunk[] = [];
  for (const hit of passing) {
    const row = byId.get(hit.id);
    if (!row || row.status !== "ready") {
      continue;
    }
    out.push({
      documentId: row.documentId,
      documentTitle: row.documentTitle,
      chunkIndex: row.chunkIndex,
      content: row.content,
      score: hit.score,
    });
  }
  return out;
}

function scoreChunks(
  chunks: CorpusChunk[],
  queryEmbedding: number[],
  limit: number,
): RetrievedChunk[] {
  return chunks
    .map((c) => ({
      documentId: c.documentId,
      documentTitle: c.documentTitle,
      chunkIndex: c.chunkIndex,
      content: c.content,
      score: c.vector ? cosineSimilarity(queryEmbedding, c.vector) : 0,
    }))
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
