import "server-only";

import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { editorDocuments, type EditorDocument } from "@/db/schema";
import { deleteDocument, ingestTextDocument } from "./documents";

const TITLE_MAX = 80;

export function listEditorDocuments(): EditorDocument[] {
  return db
    .select()
    .from(editorDocuments)
    .orderBy(desc(editorDocuments.updatedAt))
    .all();
}

export function getEditorDocument(id: string): EditorDocument | undefined {
  return db.select().from(editorDocuments).where(eq(editorDocuments.id, id)).get();
}

export function createEditorDocument(): EditorDocument {
  const id = randomUUID();
  return db.insert(editorDocuments).values({ id }).returning().get();
}

export function renameEditorDocument(
  id: string,
  title: string,
): EditorDocument | undefined {
  const trimmed = title.trim().slice(0, TITLE_MAX) || "Untitled document";
  return db
    .update(editorDocuments)
    .set({ title: trimmed, updatedAt: new Date().toISOString() })
    .where(eq(editorDocuments.id, id))
    .returning()
    .get();
}

export function deleteEditorDocument(id: string): void {
  const doc = getEditorDocument(id);
  if (doc?.documentId) {
    // Remove the mirrored RAG document (its chunks cascade).
    deleteDocument(doc.documentId);
  }
  db.delete(editorDocuments).where(eq(editorDocuments.id, id)).run();
}

/** Persists content (and optionally title) without touching the RAG mirror. */
export function saveEditorContent(
  id: string,
  input: { title?: string; content: string },
): EditorDocument | undefined {
  const set: Partial<EditorDocument> = {
    content: input.content,
    updatedAt: new Date().toISOString(),
  };
  if (typeof input.title === "string") {
    set.title = input.title.trim().slice(0, TITLE_MAX) || "Untitled document";
  }
  return db
    .update(editorDocuments)
    .set(set)
    .where(eq(editorDocuments.id, id))
    .returning()
    .get();
}

/**
 * Rebuilds the document's RAG mirror so Chat/Agents can reference its current
 * content. Drops the previous mirror (FK nulls our link), then re-ingests.
 * A blank document is simply un-indexed.
 */
export async function reindexEditorDocument(
  id: string,
): Promise<EditorDocument | undefined> {
  const doc = getEditorDocument(id);
  if (!doc) {
    return undefined;
  }

  if (doc.documentId) {
    deleteDocument(doc.documentId);
  }

  if (!doc.content.trim()) {
    return db
      .update(editorDocuments)
      .set({ documentId: null })
      .where(eq(editorDocuments.id, id))
      .returning()
      .get();
  }

  const mirror = await ingestTextDocument({
    title: doc.title,
    text: doc.content,
    source: "editor",
  });

  return db
    .update(editorDocuments)
    .set({ documentId: mirror.id })
    .where(eq(editorDocuments.id, id))
    .returning()
    .get();
}
