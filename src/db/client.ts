import "server-only";

import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "loom.db");
const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

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

/**
 * Brings the local DB up to the committed migrations on first use.
 *
 * The alternative is that pulling a change with a new column leaves the app
 * throwing `no such column` on page load until the user remembers to run
 * `npm run db:migrate` — a bad trade for a single-user app whose database is a
 * file in the repo. Applying migrations is idempotent (drizzle records what it
 * has run), so this is a no-op on every boot after the first.
 */
function applyMigrations(client: DbClient): void {
  if (!fs.existsSync(MIGRATIONS_DIR)) return;
  try {
    migrate(client, { migrationsFolder: MIGRATIONS_DIR });
  } catch (err) {
    // Don't take the whole app down: the tables an unmigrated page needs may
    // well exist. Say plainly what happened and what fixes it, then carry on.
    console.error(
      "[loom] Could not apply database migrations automatically. " +
        "Run `npm run db:migrate` and restart.\n",
      err,
    );
  }
}

const globalForDb = globalThis as unknown as {
  __loomSqlite?: Sqlite;
  __loomDb?: DbClient;
};

/** Raw better-sqlite3 handle — needed for extensions (sqlite-vec) and raw SQL. */
const existing = globalForDb.__loomDb;
export const rawDb: Sqlite = globalForDb.__loomSqlite ?? createSqlite();
export const db: DbClient = existing ?? drizzle(rawDb, { schema });

// Once per process, before anything queries a table.
if (!existing) applyMigrations(db);

if (process.env.NODE_ENV !== "production") {
  globalForDb.__loomSqlite = rawDb;
  globalForDb.__loomDb = db;
}
