import "server-only";

import { randomUUID } from "node:crypto";
import { generateObject, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";

import { getChatModel } from "./provider";
import { getConversation, getMessages } from "./conversations";
import { createCanvas, renameCanvas, saveCanvasGraph, type CanvasGraph } from "./canvas";
import { getLatestReport } from "./research";

const MAX_CONTENT_CHARS = 12_000;

const graphSchema = z.object({
  title: z.string().describe("A short title for the concept map (3–6 words)."),
  nodes: z
    .array(
      z.object({
        id: z.string().describe("Short unique id you reference in edges, e.g. 'n1'."),
        type: z.enum(["heading", "idea"]).describe("'heading' for a theme/section, 'idea' for a specific point."),
        text: z.string().describe("Short label: a few words to one sentence."),
      }),
    )
    .describe("6–16 nodes."),
  edges: z
    .array(z.object({ source: z.string(), target: z.string() }))
    .describe("Connections by node id (heading→idea, or idea→idea)."),
});

type RawGraph = z.infer<typeof graphSchema>;

const SYSTEM =
  "You convert a working session into a concise concept map (a graph of nodes and edges). " +
  "Use 'heading' nodes for the main themes or sections, and 'idea' nodes for specific points, " +
  "claims, tasks, or facts under them. Connect each heading to its related ideas, and link ideas " +
  "that relate to each other. Keep node text short. Aim for 6–16 nodes total. Every edge must " +
  "reference node ids that exist. Capture the substance of the session, not the chit-chat.";

/** Asks the model for a graph; falls back to tolerant JSON parsing if structured output fails. */
async function extractGraph(model: LanguageModel, content: string): Promise<RawGraph> {
  const prompt = `Here is the session to map:\n\n${content.slice(0, MAX_CONTENT_CHARS)}`;
  try {
    const { object } = await generateObject({ model, schema: graphSchema, system: SYSTEM, prompt });
    return object;
  } catch {
    const { text } = await generateText({
      model,
      system: `${SYSTEM}\n\nReturn ONLY a JSON object: {"title":string,"nodes":[{"id":string,"type":"heading"|"idea","text":string}],"edges":[{"source":string,"target":string}]}`,
      prompt,
    });
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The model did not return a usable graph.");
    return graphSchema.parse(JSON.parse(match[0]));
  }
}

/** Estimates a node's rendered size for layout (no DOM available server-side). */
function nodeSize(type: string, text: string): { width: number; height: number } {
  const width = 220;
  if (type === "heading") return { width, height: 46 };
  const lines = Math.ceil(Math.max(text.length, 1) / 26);
  return { width, height: Math.min(160, Math.max(54, 28 + lines * 20)) };
}

/** Remaps model-local ids to UUIDs, validates edges, and lays the graph out with dagre. */
function toCanvasGraph(raw: RawGraph): CanvasGraph {
  const idMap = new Map<string, string>();
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 90 });

  const nodes: Node[] = [];
  for (const n of raw.nodes) {
    if (!n.text.trim() || idMap.has(n.id)) continue;
    const id = randomUUID();
    idMap.set(n.id, id);
    const type = n.type === "heading" ? "heading" : "idea";
    const size = nodeSize(type, n.text);
    g.setNode(id, size);
    nodes.push({ id, type, position: { x: 0, y: 0 }, data: { text: n.text.trim() } });
  }

  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const e of raw.edges) {
    const source = idMap.get(e.source);
    const target = idMap.get(e.target);
    if (!source || !target || source === target) continue;
    const key = `${source}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    g.setEdge(source, target);
    edges.push({ id: randomUUID(), source, target });
  }

  dagre.layout(g);
  for (const node of nodes) {
    const pos = g.node(node.id);
    node.position = { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 };
  }

  return { nodes, edges };
}

function transcriptFromMessages(conversationId: string): string {
  return getMessages(conversationId)
    .filter((m) => m.content.trim())
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.trim()}`)
    .join("\n\n");
}

export type SeedKind = "conversation" | "research";

/**
 * Builds a concept-map canvas from a Chat/Agent transcript or a Research report,
 * persists it, and returns the new canvas id.
 */
export async function seedCanvasFromSource(sourceId: string, kind: SeedKind): Promise<string> {
  const conversation = getConversation(sourceId);
  if (!conversation) throw new Error("Source conversation not found.");

  let content: string;
  let fallbackTitle: string;
  if (kind === "research") {
    const report = getLatestReport(sourceId);
    if (!report || !report.report.trim()) {
      throw new Error("No finished research report to send.");
    }
    content = `Research question: ${report.question}\n\nReport:\n${report.report}`;
    fallbackTitle = report.question;
  } else {
    content = transcriptFromMessages(sourceId);
    if (!content.trim()) throw new Error("This conversation is empty.");
    fallbackTitle = conversation.title;
  }

  const { model, modelId } = getChatModel(conversation.model);
  if (!modelId) throw new Error("No model configured. Set a model in Settings.");

  const raw = await extractGraph(model, content);
  const graph = toCanvasGraph(raw);
  if (graph.nodes.length === 0) throw new Error("The model produced an empty map.");

  const canvas = createCanvas();
  renameCanvas(canvas.id, (raw.title || fallbackTitle).slice(0, 60));
  saveCanvasGraph(canvas.id, graph);
  return canvas.id;
}
