// Client-safe shape of the "context used" data part streamed with assistant
// replies: which memories and document chunks were injected into the system
// prompt for that turn. Written by the chat/agent routes, rendered by
// `RetrievalBlock`, and persisted with the message parts for replay.

export interface RetrievalMemory {
  type: string;
  content: string;
}

export interface RetrievalChunk {
  documentTitle: string;
  chunkIndex: number;
  /** Cosine similarity against the query, 0–1. */
  score: number;
  excerpt: string;
}

export interface RetrievalInfo {
  memories: RetrievalMemory[];
  chunks: RetrievalChunk[];
}

/** The UIMessage data-part type tag carrying RetrievalInfo. */
export const RETRIEVAL_PART_TYPE = "data-retrieval" as const;
