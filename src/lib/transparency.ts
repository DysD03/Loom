import "server-only";

import type { Memory } from "@/db/schema";
import type { RetrievedChunk } from "./documents";
import type { RetrievalInfo } from "./retrieval";

const EXCERPT_MAX = 240;

/**
 * Condenses the retrieval results injected into a system prompt into the
 * client-facing `RetrievalInfo` data part. Returns null when nothing was
 * retrieved so callers can skip the part entirely.
 */
export function buildRetrievalInfo(
  memories: Memory[],
  chunks: RetrievedChunk[],
): RetrievalInfo | null {
  if (memories.length === 0 && chunks.length === 0) {
    return null;
  }
  return {
    memories: memories.map((m) => ({ type: m.type, content: m.content })),
    chunks: chunks.map((c) => ({
      documentTitle: c.documentTitle,
      chunkIndex: c.chunkIndex,
      score: Number(c.score.toFixed(3)),
      excerpt: c.content.slice(0, EXCERPT_MAX),
    })),
  };
}
