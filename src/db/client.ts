import "server-only";

import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "loom.db");

function createDb() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  // With WAL, NORMAL only skips the per-commit fsync (durability moves to
  // checkpoints) — it cannot corrupt the DB, and writes stop paying disk sync
  // latency on every persisted message.
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

type DbClient = ReturnType<typeof createDb>;

const globalForDb = globalThis as unknown as { __loomDb?: DbClient };

export const db: DbClient = globalForDb.__loomDb ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__loomDb = db;
}
