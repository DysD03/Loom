// Applies the committed Drizzle migrations to ./data/loom.db before the server
// starts. Uses only production deps (better-sqlite3 + drizzle-orm) so it runs in
// the pruned Docker runtime without drizzle-kit. Mirrors the pragmas set in
// src/db/client.ts. Run from the app root: `node scripts/migrate.mjs`.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const sqlite = new Database(path.join(dataDir, "loom.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

migrate(drizzle(sqlite), { migrationsFolder: path.join(process.cwd(), "drizzle") });
sqlite.close();

console.log("[loom] migrations applied");
