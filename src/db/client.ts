import "server-only";

import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "loom.db");

function createSqlite() {
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
  return sqlite;
}

type Sqlite = ReturnType<typeof createSqlite>;
type DbClient = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  __loomSqlite?: Sqlite;
  __loomDb?: DbClient;
};

/** Raw better-sqlite3 handle — needed for extensions (sqlite-vec) and raw SQL. */
export const rawDb: Sqlite = globalForDb.__loomSqlite ?? createSqlite();
export const db: DbClient = globalForDb.__loomDb ?? drizzle(rawDb, { schema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__loomSqlite = rawDb;
  globalForDb.__loomDb = db;
}
