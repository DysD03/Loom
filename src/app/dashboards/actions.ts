"use server";

import { revalidatePath } from "next/cache";

import {
  createDashboard,
  deleteDashboard,
  getDashboard,
  regenerateSpec,
  renameDashboard,
  saveDashboardSource,
} from "@/lib/dashboards";
import { extractMarkdownTitle } from "@/lib/dashboard-spec";
import { getEditorDocument } from "@/lib/editor";

export interface CreateDashboardResult {
  id: string;
  /** Set when the model was unreachable and the deterministic parser filled in. */
  warning?: string;
}

async function createFromMarkdown(input: {
  title?: string;
  markdown: string;
  sourceName: string;
}): Promise<CreateDashboardResult | { error: string }> {
  const markdown = input.markdown.trim();
  if (!markdown) {
    return { error: "Add some Markdown first." };
  }

  const title =
    input.title?.trim() ||
    extractMarkdownTitle(markdown) ||
    input.sourceName ||
    "Untitled dashboard";
  const row = createDashboard({ title, sourceMarkdown: markdown, sourceName: input.sourceName });

  const result = await regenerateSpec(row);
  revalidatePath("/dashboards");
  if ("error" in result) {
    // Unreachable in practice: a fresh row has no spec, so regenerateSpec falls back.
    return { id: row.id, warning: result.error };
  }
  if (result.generatedBy === "fallback") {
    const refreshed = getDashboard(row.id);
    return { id: row.id, warning: refreshed?.error ?? "Built without the model." };
  }
  return { id: row.id };
}

export async function createDashboardAction(input: {
  title?: string;
  markdown: string;
  sourceName?: string;
}): Promise<CreateDashboardResult | { error: string }> {
  return createFromMarkdown({
    title: input.title,
    markdown: input.markdown,
    sourceName: input.sourceName?.trim() || "Pasted Markdown",
  });
}

export async function createFromEditorDocAction(
  docId: string,
): Promise<CreateDashboardResult | { error: string }> {
  const doc = getEditorDocument(docId);
  if (!doc) {
    return { error: "That Editor document no longer exists." };
  }
  if (!doc.content.trim()) {
    return { error: "That Editor document is empty." };
  }
  return createFromMarkdown({ title: doc.title, markdown: doc.content, sourceName: doc.title });
}

/** Loads an Editor document's Markdown into the create form for preview/editing. */
export async function loadEditorDocAction(
  docId: string,
): Promise<{ title: string; content: string } | { error: string }> {
  const doc = getEditorDocument(docId);
  if (!doc) {
    return { error: "That Editor document no longer exists." };
  }
  return { title: doc.title, content: doc.content };
}

export async function regenerateDashboardAction(
  id: string,
  instructions?: string,
): Promise<{ ok: true } | { error: string }> {
  const row = getDashboard(id);
  if (!row) {
    return { error: "Dashboard not found." };
  }
  const result = await regenerateSpec(row, instructions);
  if ("error" in result) {
    return result;
  }
  revalidatePath("/dashboards");
  return { ok: true };
}

/** Persists edited source Markdown; the user triggers Regenerate separately. */
export async function saveDashboardSourceAction(
  id: string,
  markdown: string,
): Promise<{ ok: true } | { error: string }> {
  const row = saveDashboardSource(id, markdown);
  if (!row) {
    return { error: "Dashboard not found." };
  }
  return { ok: true };
}

export async function renameDashboardAction(id: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) {
    return;
  }
  renameDashboard(id, trimmed);
  revalidatePath("/dashboards");
}

export async function deleteDashboardAction(id: string): Promise<void> {
  deleteDashboard(id);
  revalidatePath("/dashboards");
}
