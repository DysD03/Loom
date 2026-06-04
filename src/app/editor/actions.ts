"use server";

import { revalidatePath } from "next/cache";
import { generateText } from "ai";

import {
  createEditorDocument,
  deleteEditorDocument,
  reindexEditorDocument,
  renameEditorDocument,
  saveEditorContent,
} from "@/lib/editor";
import { getChatModel } from "@/lib/provider";

export async function newEditorDocAction(): Promise<string> {
  const doc = createEditorDocument();
  revalidatePath("/editor");
  return doc.id;
}

export async function deleteEditorDocAction(id: string): Promise<void> {
  deleteEditorDocument(id);
  revalidatePath("/editor");
}

export async function renameEditorDocAction(id: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) {
    return;
  }
  renameEditorDocument(id, trimmed);
  revalidatePath("/editor");
}

/** Light autosave — persists content/title without revalidating (the view owns its state). */
export async function saveEditorDocAction(
  id: string,
  title: string,
  content: string,
): Promise<void> {
  saveEditorContent(id, { title, content });
}

/** Rebuilds the document's RAG mirror so Chat/Agents can reference it. */
export async function reindexEditorDocAction(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    await reindexEditorDocument(id);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Indexing failed." };
  }
}

export type AssistAction = "rewrite" | "expand" | "shorten" | "fix";

const ASSIST_INSTRUCTIONS: Record<AssistAction, string> = {
  rewrite:
    "Rewrite the text to improve clarity and flow while preserving its meaning and Markdown formatting.",
  expand:
    "Expand the text with helpful detail and specifics, keeping the same voice and Markdown formatting.",
  shorten:
    "Make the text more concise while preserving its meaning and Markdown formatting.",
  fix: "Fix spelling, grammar, and punctuation without changing meaning or Markdown formatting.",
};

/**
 * Transforms selected editor text with the local model and returns the result
 * so the client can replace the selection. Non-streaming — assist edits are
 * short and applying a single replacement is simpler than splicing a stream.
 */
export async function assistEditorAction(
  action: AssistAction,
  selection: string,
  context?: string,
): Promise<{ text: string } | { error: string }> {
  const text = selection.trim();
  if (!text) {
    return { error: "Select some text in the editor first." };
  }
  let model: ReturnType<typeof getChatModel>["model"];
  let modelId: string;
  try {
    ({ model, modelId } = getChatModel());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to build model." };
  }
  if (!modelId) {
    return { error: "No model configured. Set one in Settings." };
  }

  try {
    const { text: out } = await generateText({
      model,
      system:
        "You are a writing assistant embedded in a Markdown editor. " +
        ASSIST_INSTRUCTIONS[action] +
        " Return only the transformed text, with no preamble, commentary, or surrounding code fences.",
      prompt: context?.trim()
        ? `Document context (for tone and consistency):\n\n${context.slice(0, 4000)}\n\n---\n\nText to transform:\n\n${text}`
        : text,
    });
    return { text: out.trim() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Request failed." };
  }
}
