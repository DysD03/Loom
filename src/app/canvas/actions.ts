"use server";

import { revalidatePath } from "next/cache";

import { generateObject, generateText, type LanguageModel } from "ai";
import { z } from "zod";

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
import type { CanvasChatMessage, CanvasGraphView, CanvasOp } from "@/lib/canvas-chat";

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

const flatOpSchema = z.object({
  op: z.enum(["add", "connect", "rename", "remove"]),
  id: z.string().optional(),
  nodeType: z.enum(["idea", "heading"]).optional(),
  text: z.string().optional(),
  source: z.string().optional(),
  target: z.string().optional(),
});

const canvasChatSchema = z.object({
  reply: z.string(),
  ops: z.array(flatOpSchema).default([]),
});

const CANVAS_CHAT_SYSTEM =
  "You are an assistant embedded in a visual concept-map canvas (nodes + edges). You can BOTH answer " +
  "questions about the board AND edit it. You are given the current nodes (id, type, text) and edges " +
  "(source id -> target id), then the user's message.\n" +
  'Respond with: "reply" — a short, helpful answer in plain text; and "ops" — a list of edits to apply ONLY ' +
  "when the user asks to change the board (for pure questions, return an empty ops array). Op shapes:\n" +
  '- {"op":"add","id":"<new-id>","nodeType":"idea"|"heading","text":"<label>"} — add a node; pick a fresh id you can reference in connect ops.\n' +
  '- {"op":"connect","source":"<id>","target":"<id>"} — connect two nodes (existing ids, or ids you added in this response).\n' +
  '- {"op":"rename","id":"<id>","text":"<new label>"} — change a node\'s text.\n' +
  '- {"op":"remove","id":"<id>"} — delete a node (its edges go too).\n' +
  "Use 'heading' for themes/sections and 'idea' for specific points. Keep labels short. Only reference ids " +
  "that exist or that you add in the same response. Do not restate the whole board.";

function normalizeOps(ops: z.infer<typeof flatOpSchema>[]): CanvasOp[] {
  const out: CanvasOp[] = [];
  for (const o of ops) {
    if (o.op === "add" && o.id && o.text) {
      out.push({
        op: "add",
        id: o.id,
        nodeType: o.nodeType === "heading" ? "heading" : "idea",
        text: o.text,
      });
    } else if (o.op === "connect" && o.source && o.target) {
      out.push({ op: "connect", source: o.source, target: o.target });
    } else if (o.op === "rename" && o.id && o.text) {
      out.push({ op: "rename", id: o.id, text: o.text });
    } else if (o.op === "remove" && o.id) {
      out.push({ op: "remove", id: o.id });
    }
  }
  return out;
}

/**
 * Board-aware canvas chat: answers questions about the current graph and returns
 * edit ops the client applies to the live board. Uses structured output with a
 * tolerant JSON fallback for models without it.
 */
export async function talkToCanvasAction(input: {
  message: string;
  graph: CanvasGraphView;
  history: CanvasChatMessage[];
}): Promise<{ reply: string; ops: CanvasOp[] } | { error: string }> {
  const message = input.message.trim();
  if (!message) {
    return { error: "Type a message first." };
  }
  const resolved = chatModelOrError();
  if ("error" in resolved) {
    return resolved;
  }

  const nodeLines =
    input.graph.nodes.map((n) => `${n.id} [${n.type}] ${n.text || "(empty)"}`).join("\n") || "(none)";
  const edgeLines =
    input.graph.edges.map((e) => `${e.source} -> ${e.target}`).join("\n") || "(none)";
  const historyText = input.history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");
  const prompt =
    `NODES:\n${nodeLines}\n\nEDGES:\n${edgeLines}\n\n` +
    `${historyText ? `Conversation so far:\n${historyText}\n\n` : ""}User: ${message}`;

  try {
    const { object } = await generateObject({
      model: resolved.model,
      schema: canvasChatSchema,
      system: CANVAS_CHAT_SYSTEM,
      prompt,
    });
    return { reply: object.reply, ops: normalizeOps(object.ops) };
  } catch {
    try {
      const { text } = await generateText({
        model: resolved.model,
        system: `${CANVAS_CHAT_SYSTEM}\n\nReturn ONLY a JSON object: {"reply": string, "ops": [...]}.`,
        prompt,
      });
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = canvasChatSchema.parse(JSON.parse(match[0]));
        return { reply: parsed.reply, ops: normalizeOps(parsed.ops) };
      }
      return { reply: text.trim() || "(no response)", ops: [] };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "The model request failed." };
    }
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
