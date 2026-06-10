import "server-only";

import { randomUUID } from "node:crypto";
import { embed, embedMany, generateText } from "ai";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { memories, type Memory, type MemoryType, MEMORY_TYPES } from "@/db/schema";
import { getChatModel, getEmbeddingModel } from "./provider";
import { getMessages } from "./conversations";
import { cosineSimilarity, parseVector } from "./vectors";

const DEDUPE_THRESHOLD = 0.9;
const RETRIEVAL_FLOOR = 0.3;
const MAX_EXTRACTED = 12;
const CONTENT_MAX = 400;

export function listMemories(): Memory[] {
  return db
    .select()
    .from(memories)
    .orderBy(desc(memories.pinned), desc(memories.createdAt))
    .all();
}

export async function embedText(text: string): Promise<number[] | null> {
  const embedder = getEmbeddingModel();
  if (!embedder) {
    return null;
  }
  const { embedding } = await embed({ model: embedder.model, value: text });
  return embedding;
}

async function embedTexts(texts: string[]): Promise<(number[] | null)[]> {
  const embedder = getEmbeddingModel();
  if (!embedder) {
    return texts.map(() => null);
  }
  const { embeddings } = await embedMany({ model: embedder.model, values: texts });
  return embeddings;
}

// Embeddings are stored as JSON text; parsing them is the hot cost of retrieval,
// so parsed vectors are cached per row. `updatedAt` is in the key because a
// memory's content (and thus embedding) can be edited in place.
const vectorCache = new Map<string, Float32Array | null>();
const VECTOR_CACHE_MAX = 8_192;

function memoryVector(m: Memory): Float32Array | null {
  const key = `${m.id}|${m.updatedAt}`;
  const hit = vectorCache.get(key);
  if (hit !== undefined) {
    return hit;
  }
  if (vectorCache.size >= VECTOR_CACHE_MAX) {
    vectorCache.clear();
  }
  const vec = parseVector(m.embedding);
  vectorCache.set(key, vec);
  return vec;
}

function isTextDuplicate(content: string, existing: Memory[]): boolean {
  const needle = content.trim().toLowerCase();
  return existing.some((m) => m.content.trim().toLowerCase() === needle);
}

interface NewMemory {
  content: string;
  type: MemoryType;
  sourceConversationId?: string | null;
  embedding: number[] | null;
}

function insertMemory(input: NewMemory): Memory {
  return db
    .insert(memories)
    .values({
      id: randomUUID(),
      content: input.content.slice(0, CONTENT_MAX),
      type: input.type,
      sourceConversationId: input.sourceConversationId ?? null,
      embedding: input.embedding ? JSON.stringify(input.embedding) : null,
    })
    .returning()
    .get();
}

/** Adds a single memory manually (e.g. from the Memory tab), embedding it when possible. */
export async function addMemory(content: string, type: MemoryType): Promise<Memory> {
  const embedding = await embedText(content);
  return insertMemory({ content, type, embedding });
}

export async function updateMemory(
  id: string,
  content: string,
  type: MemoryType,
): Promise<Memory | undefined> {
  const embedding = await embedText(content);
  return db
    .update(memories)
    .set({
      content: content.slice(0, CONTENT_MAX),
      type,
      embedding: embedding ? JSON.stringify(embedding) : null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(memories.id, id))
    .returning()
    .get();
}

export function deleteMemory(id: string): void {
  db.delete(memories).where(eq(memories.id, id)).run();
}

export function setMemoryPinned(id: string, pinned: boolean): Memory | undefined {
  return db
    .update(memories)
    .set({ pinned, updatedAt: new Date().toISOString() })
    .where(eq(memories.id, id))
    .returning()
    .get();
}

interface ExtractedItem {
  content: string;
  type: MemoryType;
}

function parseExtraction(text: string): ExtractedItem[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) {
    return [];
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  const typeSet = new Set<string>(MEMORY_TYPES);
  const items: ExtractedItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as { content?: unknown; type?: unknown };
    const content = typeof record.content === "string" ? record.content.trim() : "";
    if (!content) {
      continue;
    }
    const type =
      typeof record.type === "string" && typeSet.has(record.type)
        ? (record.type as MemoryType)
        : "fact";
    items.push({ content, type });
  }
  return items.slice(0, MAX_EXTRACTED);
}

const EXTRACTION_SYSTEM =
  "You extract durable facts about the user from a conversation, to remember across future sessions. " +
  "Capture stable, reusable information: preferences, ongoing projects, goals, and persistent personal/professional context. " +
  "Ignore one-off questions, transient task details, and anything not durably true about the user. " +
  'Respond with ONLY a JSON array of objects: [{ "content": string, "type": "preference"|"project"|"goal"|"context"|"fact" }]. ' +
  "Each content should be a single concise fact phrased about the user. If there is nothing durable, return [].";

/** Extracts durable memories from a conversation, de-duplicates, and stores new ones. */
export async function extractMemoriesFromConversation(
  conversationId: string,
): Promise<{ added: Memory[]; skipped: number }> {
  const rows = getMessages(conversationId).filter((m) => m.role !== "system");
  if (rows.length === 0) {
    return { added: [], skipped: 0 };
  }

  const transcript = rows
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const { model } = getChatModel();
  const { text } = await generateText({
    model,
    system: EXTRACTION_SYSTEM,
    prompt: `Conversation:\n\n${transcript}\n\nExtract durable facts about the user as a JSON array.`,
  });

  const candidates = parseExtraction(text);
  if (candidates.length === 0) {
    return { added: [], skipped: 0 };
  }

  const existing = listMemories();
  const candidateEmbeddings = await embedTexts(candidates.map((c) => c.content));

  const added: Memory[] = [];
  const acceptedEmbeddings: number[][] = [];
  let skipped = 0;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const embedding = candidateEmbeddings[i];

    let duplicate = isTextDuplicate(candidate.content, existing);
    if (!duplicate && embedding) {
      const pool: ArrayLike<number>[] = [
        ...existing.map((m) => memoryVector(m)).filter((e): e is Float32Array => e !== null),
        ...acceptedEmbeddings,
      ];
      duplicate = pool.some((e) => cosineSimilarity(embedding, e) >= DEDUPE_THRESHOLD);
    }

    if (duplicate) {
      skipped += 1;
      continue;
    }

    const inserted = insertMemory({
      content: candidate.content,
      type: candidate.type,
      sourceConversationId: conversationId,
      embedding,
    });
    added.push(inserted);
    existing.push(inserted);
    if (embedding) {
      acceptedEmbeddings.push(embedding);
    }
  }

  return { added, skipped };
}

/**
 * Retrieves memories to inject into a session's system prompt: pinned memories
 * always, plus the top semantic matches for the query when embeddings are available.
 * Pass `queryEmbedding` when the caller already embedded the query (e.g. to share
 * one embedding call across memory + document retrieval); `undefined` embeds here.
 */
export async function retrieveRelevantMemories(
  query: string,
  limit = 6,
  queryEmbedding?: number[] | null,
): Promise<Memory[]> {
  const all = listMemories();
  if (all.length === 0) {
    return [];
  }

  const pinned = all.filter((m) => m.pinned);
  const resolvedEmbedding =
    queryEmbedding !== undefined
      ? queryEmbedding
      : query.trim()
        ? await embedText(query)
        : null;

  if (!resolvedEmbedding) {
    return all.slice(0, limit);
  }

  const pinnedIds = new Set(pinned.map((m) => m.id));
  const scored = all
    .filter((m) => !pinnedIds.has(m.id))
    .map((m) => {
      const embedding = memoryVector(m);
      return { memory: m, score: embedding ? cosineSimilarity(resolvedEmbedding, embedding) : 0 };
    })
    .filter((entry) => entry.score >= RETRIEVAL_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.memory);

  return [...pinned, ...scored];
}

export function formatMemoriesForPrompt(items: Memory[]): string {
  if (items.length === 0) {
    return "";
  }
  const lines = items.map((m) => `- (${m.type}) ${m.content}`).join("\n");
  return `What you know about the user (from prior sessions):\n${lines}`;
}
