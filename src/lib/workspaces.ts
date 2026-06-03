import "server-only";

import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { homedir } from "node:os";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { workspaces, type Workspace } from "@/db/schema";

const TITLE_MAX = 60;

/** Expands a leading `~` and resolves to an absolute path. */
function normalizePath(input: string): string {
  const trimmed = input.trim();
  const expanded = trimmed.startsWith("~")
    ? trimmed.replace(/^~(?=$|\/)/, homedir())
    : trimmed;
  return resolve(expanded);
}

export function listWorkspaces(): Workspace[] {
  return db.select().from(workspaces).orderBy(desc(workspaces.updatedAt)).all();
}

export function getWorkspace(id: string): Workspace | undefined {
  return db.select().from(workspaces).where(eq(workspaces.id, id)).get();
}

export interface CreateWorkspaceResult {
  workspace?: Workspace;
  error?: string;
}

export function createWorkspace(rawPath: string, title?: string): CreateWorkspaceResult {
  if (!rawPath.trim()) {
    return { error: "Enter a folder path." };
  }
  const path = normalizePath(rawPath);
  if (!existsSync(path)) {
    return { error: `Folder does not exist: ${path}` };
  }
  if (!statSync(path).isDirectory()) {
    return { error: `Not a folder: ${path}` };
  }
  const name = (title?.trim() || basename(path) || "Workspace").slice(0, TITLE_MAX);
  const workspace = db
    .insert(workspaces)
    .values({ id: randomUUID(), title: name, path })
    .returning()
    .get();
  return { workspace };
}

export function deleteWorkspace(id: string): void {
  db.delete(workspaces).where(eq(workspaces.id, id)).run();
}

export function renameWorkspace(id: string, title: string): void {
  const trimmed = title.trim().slice(0, TITLE_MAX) || "Workspace";
  db.update(workspaces)
    .set({ title: trimmed, updatedAt: new Date().toISOString() })
    .where(eq(workspaces.id, id))
    .run();
}
