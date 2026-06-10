import "server-only";

import * as sqliteVec from "sqlite-vec";

import { rawDb } from "@/db/client";

/**
 * sqlite-vec index over document-chunk embeddings, with graceful degradation:
 * if the extension can't load (or anything errors), callers fall back to the
 * in-process cosine scan. The vec0 table is derived state — embeddings stay
 * canonical as JSON on `document_chunks`, so the index can always be rebuilt
 * (including after an embeddings-model change that alters the dimension).
 */

const TABLE = "chunk_vectors";

type VecState = "unknown" | "ready" | "unavailable";

// Survives hot-reload alongside the db handle.
const g = globalThis as typeof globalThis & {
  __loomVecState?: VecState;
  __loomVecSyncStamp?: string;
};

function loadExtension(): boolean {
  const state = g.__loomVecState ?? "unknown";
  if (state !== "unknown") {
    return state === "ready";
  }
  try {
    sqliteVec.load(rawDb);
    rawDb.prepare("select vec_version()").get();
    g.__loomVecState = "ready";
    return true;
  } catch {
    g.__loomVecState = "unavailable";
    return false;
  }
}

/** Marks vec unusable for this process after an unexpected error. */
function disable(): void {
  g.__loomVecState = "unavailable";
}

/** The dimension of the existing vec table, or null when it doesn't exist. */
function tableDim(): number | null {
  const row = rawDb
    .prepare("select sql from sqlite_master where type = 'table' and name = ?")
    .get(TABLE) as { sql?: string } | undefined;
  const match = row?.sql?.match(/float\[(\d+)\]/);
  return match ? Number(match[1]) : null;
}

function ensureTable(dim: number): void {
  const existing = tableDim();
  if (existing === dim) {
    return;
  }
  if (existing !== null) {
    // Dimension changed (new embeddings model) — rebuild from scratch.
    rawDb.exec(`drop table if exists ${TABLE}`);
    g.__loomVecSyncStamp = undefined;
  }
  rawDb.exec(
    `create virtual table if not exists ${TABLE} using vec0(chunk_id text primary key, embedding float[${dim}] distance_metric=cosine)`,
  );
}

/**
 * Reconciles the index with `document_chunks` when its row count drifts (e.g.
 * first run on an existing DB, or chunks written while vec was unavailable).
 * Vectors whose dimension doesn't match the table are skipped — the JS cosine
 * fallback scores those 0 as well.
 */
function syncIndex(dim: number): void {
  const { total } = rawDb
    .prepare("select count(*) as total from document_chunks where embedding is not null")
    .get() as { total: number };
  const stamp = `${dim}|${total}`;
  if (g.__loomVecSyncStamp === stamp) {
    return;
  }

  const { indexed } = rawDb
    .prepare(`select count(*) as indexed from ${TABLE}`)
    .get() as { indexed: number };
  if (indexed !== total) {
    rawDb.exec(`delete from ${TABLE}`);
    const rows = rawDb
      .prepare("select id, embedding from document_chunks where embedding is not null")
      .all() as { id: string; embedding: string }[];
    const insert = rawDb.prepare(
      `insert or replace into ${TABLE}(chunk_id, embedding) values (?, ?)`,
    );
    for (const row of rows) {
      try {
        insert.run(row.id, row.embedding);
      } catch {
        // Dimension mismatch (old model) or corrupt JSON — skip this chunk.
      }
    }
  }
  g.__loomVecSyncStamp = stamp;
}

/** Adds freshly ingested chunk vectors to the index. Safe to call always. */
export function indexChunkVectors(entries: { id: string; embedding: number[] }[]): void {
  const first = entries.find((e) => e.embedding.length > 0);
  if (!first || !loadExtension()) {
    return;
  }
  try {
    ensureTable(first.embedding.length);
    const insert = rawDb.prepare(
      `insert or replace into ${TABLE}(chunk_id, embedding) values (?, ?)`,
    );
    for (const entry of entries) {
      try {
        insert.run(entry.id, JSON.stringify(entry.embedding));
      } catch {
        // Dimension mismatch — the next full sync after a model change fixes it.
      }
    }
    g.__loomVecSyncStamp = undefined;
  } catch {
    disable();
  }
}

/** Removes chunk vectors (call before/after deleting their document). */
export function removeChunkVectors(chunkIds: string[]): void {
  if (chunkIds.length === 0 || !loadExtension() || tableDim() === null) {
    return;
  }
  try {
    const del = rawDb.prepare(`delete from ${TABLE} where chunk_id = ?`);
    for (const id of chunkIds) {
      del.run(id);
    }
    g.__loomVecSyncStamp = undefined;
  } catch {
    disable();
  }
}

/**
 * KNN search over the index. Returns chunk ids with cosine-similarity scores
 * (best first), or null when sqlite-vec is unavailable so the caller can fall
 * back to the in-process scan.
 */
export function searchChunkVectors(
  queryEmbedding: number[],
  k: number,
): { id: string; score: number }[] | null {
  if (!loadExtension()) {
    return null;
  }
  try {
    ensureTable(queryEmbedding.length);
    syncIndex(queryEmbedding.length);
    const rows = rawDb
      .prepare(
        `select chunk_id, distance from ${TABLE} where embedding match ? and k = ?`,
      )
      .all(JSON.stringify(queryEmbedding), k) as { chunk_id: string; distance: number }[];
    return rows.map((r) => ({ id: r.chunk_id, score: 1 - r.distance }));
  } catch {
    disable();
    return null;
  }
}
