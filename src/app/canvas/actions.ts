"use server";

import { revalidatePath } from "next/cache";

import { generateText } from "ai";

import {
  createCanvas,
  deleteCanvas,
  renameCanvas,
  saveCanvasGraph,
  type CanvasGraph,
} from "@/lib/canvas";
import { seedCanvasFromSource, type SeedKind } from "@/lib/seed";
import { getChatModel } from "@/lib/provider";

const EXPAND_SYSTEM =
  "You expand a node in a visual mind-map. Given a snippet of text and the user's question about " +
  "it, write a focused, concrete answer that stands alone as a new node — a few sentences or a short " +
  "bullet list. Be specific, no preamble, no restating the question. Plain text or simple Markdown.";

export async function newCanvasAction(): Promise<string> {
  const canvas = createCanvas();
  revalidatePath("/canvas");
  return canvas.id;
}

export async function deleteCanvasAction(id: string): Promise<void> {
  deleteCanvas(id);
  revalidatePath("/canvas");
}

export async function renameCanvasAction(id: string, title: string): Promise<void> {
  renameCanvas(id, title);
  revalidatePath("/canvas");
}

/** Persists the full graph. Called (debounced) from the board on edits. */
export async function saveCanvasAction(id: string, graph: CanvasGraph): Promise<void> {
  saveCanvasGraph(id, graph);
  // No revalidate: the board owns its in-memory state; avoid a refresh round-trip.
}

/**
 * Turns a Chat/Agent transcript or a Research report into a new concept-map
 * canvas. Returns the canvas id on success, or a user-facing error message.
 */
export async function sendToCanvasAction(
  sourceId: string,
  kind: SeedKind,
): Promise<{ canvasId: string } | { error: string }> {
  try {
    const canvasId = await seedCanvasFromSource(sourceId, kind);
    revalidatePath("/canvas");
    return { canvasId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to build the canvas." };
  }
}

/**
 * Asks the local LLM to expand on a selected snippet from a canvas node,
 * answering the user's question. Returns text for a new connected node.
 */
export async function expandCanvasNodeAction(
  context: string,
  question: string,
): Promise<{ text: string } | { error: string }> {
  const snippet = context.trim().slice(0, 2_000);
  if (!snippet) {
    return { error: "Select or type some text in the node first." };
  }
  const { model, modelId } = getChatModel();
  if (!modelId) {
    return { error: "No model configured. Set a model in Settings." };
  }
  const q = question.trim().slice(0, 500);
  const prompt = q
    ? `Selected text:\n"""${snippet}"""\n\nQuestion: ${q}\n\nWrite the expansion.`
    : `Selected text:\n"""${snippet}"""\n\nExpand on this with the most useful detail. Write the expansion.`;
  try {
    const { text } = await generateText({ model, system: EXPAND_SYSTEM, prompt });
    const trimmed = text.trim();
    if (!trimmed) return { error: "The model returned nothing." };
    return { text: trimmed };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The model request failed." };
  }
}
