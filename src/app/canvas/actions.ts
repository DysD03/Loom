"use server";

import { revalidatePath } from "next/cache";

import { generateText, type LanguageModel } from "ai";

import {
  createCanvas,
  deleteCanvas,
  renameCanvas,
  saveCanvasGraph,
  type CanvasGraph,
} from "@/lib/canvas";
import { seedCanvasFromPrompt, seedCanvasFromSource, type SeedKind } from "@/lib/seed";
import { createRunCanvas, getLatestRun, loadRun } from "@/lib/bidirectional";
import { getChatModel } from "@/lib/provider";

const EXPAND_SYSTEM =
  "You expand a node in a visual mind-map. Given a snippet of text and the user's question about " +
  "it, write a focused, concrete answer that stands alone as a new node — a few sentences or a short " +
  "bullet list. Be specific, no preamble, no restating the question. Plain text or simple Markdown.";

const BRANCH_SYSTEM =
  "You brainstorm child ideas for a node in a visual mind-map. Given the node's text, propose " +
  "distinct, concrete follow-on ideas — each standing alone as a short node (one or two sentences). " +
  'Respond with ONLY a JSON array of strings, e.g. ["idea one", "idea two"]. No other text.';

const CRITIQUE_SYSTEM =
  "You critique a node in a visual mind-map. Given the node's text, point out the most important " +
  "gaps, risks, counterpoints, or unstated assumptions — a concise bullet list (3-5 bullets), " +
  "no preamble. Be specific and constructive.";

/** Resolves the default chat model, returning config problems as a user-facing error. */
function chatModelOrError(): { model: LanguageModel } | { error: string } {
  try {
    const { model, modelId } = getChatModel();
    if (!modelId) {
      return { error: "No model configured. Set a model in Settings." };
    }
    return { model };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to build the model." };
  }
}

/**
 * Average generation speed over a whole non-streaming call. Wall time includes
 * prompt processing, so this reads a bit lower than the live streaming rate.
 */
function tokensPerSecond(
  outputTokens: number | undefined,
  text: string,
  startedAt: number,
): number | null {
  const seconds = (Date.now() - startedAt) / 1000;
  const tokens = outputTokens ?? Math.ceil(text.length / 4);
  return seconds > 0 && tokens > 0 ? tokens / seconds : null;
}

/** Tolerantly pulls a string[] out of model output that should be a JSON array. */
function parseStringArray(text: string): string[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) {
    return [];
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

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
 * Builds a canvas of an Experimental Agent run's search graph — both frontiers
 * with the taken path (the stitched bridge) highlighted. Deterministic, no LLM.
 * Returns the canvas id on success, or a user-facing error message.
 */
export async function sendRunToCanvasAction(
  conversationId: string,
): Promise<{ canvasId: string } | { error: string }> {
  try {
    const row = getLatestRun(conversationId);
    if (!row) {
      return { error: "No goal search has been run yet." };
    }
    const canvasId = createRunCanvas(loadRun(row));
    revalidatePath("/canvas");
    return { canvasId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to build the canvas." };
  }
}

/**
 * Builds a new concept-map canvas from a free-form description typed in the
 * Canvas tab. Returns the canvas id on success, or a user-facing error message.
 */
export async function describeCanvasAction(
  description: string,
): Promise<{ canvasId: string } | { error: string }> {
  try {
    const canvasId = await seedCanvasFromPrompt(description);
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
): Promise<{ text: string; tokensPerSecond: number | null } | { error: string }> {
  const snippet = context.trim().slice(0, 2_000);
  if (!snippet) {
    return { error: "Select or type some text in the node first." };
  }
  const resolved = chatModelOrError();
  if ("error" in resolved) {
    return resolved;
  }
  const { model } = resolved;
  const q = question.trim().slice(0, 500);
  const prompt = q
    ? `Selected text:\n"""${snippet}"""\n\nQuestion: ${q}\n\nWrite the expansion.`
    : `Selected text:\n"""${snippet}"""\n\nExpand on this with the most useful detail. Write the expansion.`;
  try {
    const startedAt = Date.now();
    const { text, usage } = await generateText({ model, system: EXPAND_SYSTEM, prompt });
    const trimmed = text.trim();
    if (!trimmed) return { error: "The model returned nothing." };
    return { text: trimmed, tokensPerSecond: tokensPerSecond(usage.outputTokens, text, startedAt) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The model request failed." };
  }
}

/**
 * Brainstorms 3–4 distinct child ideas for a canvas node. Returns one string
 * per idea; the client adds them as connected child nodes.
 */
export async function branchCanvasNodeAction(
  context: string,
): Promise<{ ideas: string[]; tokensPerSecond: number | null } | { error: string }> {
  const snippet = context.trim().slice(0, 2_000);
  if (!snippet) {
    return { error: "Add some text to the node first." };
  }
  const resolved = chatModelOrError();
  if ("error" in resolved) {
    return resolved;
  }
  try {
    const startedAt = Date.now();
    const { text, usage } = await generateText({
      model: resolved.model,
      system: BRANCH_SYSTEM,
      prompt: `Node:\n"""${snippet}"""\n\nPropose 3-4 child ideas as a JSON array of strings.`,
    });
    const ideas = parseStringArray(text).slice(0, 4);
    if (ideas.length === 0) {
      return { error: "The model returned no usable ideas." };
    }
    return { ideas, tokensPerSecond: tokensPerSecond(usage.outputTokens, text, startedAt) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The model request failed." };
  }
}

/** Asks the model to critique a canvas node (gaps, risks, counterpoints). */
export async function critiqueCanvasNodeAction(
  context: string,
): Promise<{ text: string; tokensPerSecond: number | null } | { error: string }> {
  const snippet = context.trim().slice(0, 2_000);
  if (!snippet) {
    return { error: "Add some text to the node first." };
  }
  const resolved = chatModelOrError();
  if ("error" in resolved) {
    return resolved;
  }
  try {
    const startedAt = Date.now();
    const { text, usage } = await generateText({
      model: resolved.model,
      system: CRITIQUE_SYSTEM,
      prompt: `Node:\n"""${snippet}"""\n\nWrite the critique.`,
    });
    const trimmed = text.trim();
    if (!trimmed) return { error: "The model returned nothing." };
    return { text: trimmed, tokensPerSecond: tokensPerSecond(usage.outputTokens, text, startedAt) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The model request failed." };
  }
}
