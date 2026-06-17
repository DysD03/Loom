import "server-only";

import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { generateText, type LanguageModel } from "ai";
import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";

import { db } from "@/db/client";
import { goalRuns, mcpServers, type GoalRun, type GoalStatus } from "@/db/schema";
import { createCanvas, renameCanvas, saveCanvasGraph, type CanvasGraph } from "./canvas";
import { searxngSearch, type SearchResult } from "./web";
import { callMcpTool, connectServer, syncMcpServersFromFile } from "./mcp";
import {
  DEFAULT_GOAL_ROUNDS,
  GOAL_ROUNDS_MAX,
  GOAL_ROUNDS_MIN,
  type BridgeResult,
  type GoalNode,
  type GoalSide,
  type ReconcileResult,
  type ToolLogEntry,
} from "./bidirectional-config";

export type {
  BridgeResult,
  GoalNode,
  GoalSide,
  ReconcileResult,
  ToolLogEntry,
} from "./bidirectional-config";

// Search sizing — bounded so the running context fits a local model. Each round
// expands the cheapest unexpanded node on each side (Dijkstra-style), then the
// reconciler checks for a meeting. Beam pruning caps frontier blow-up.
const BEAM_WIDTH = 6; // cheapest unexpanded nodes kept per side
const MAX_NEW_PER_EXPANSION = 3; // 1–3 children per expansion (per the spec)
const STALL_ROUNDS = 3; // stop if the best reconciler score hasn't improved for this many rounds

// Low temperature keeps the agents grounded. No maxOutputTokens cap — the prompt
// GUARDRAILS do the brevity work, and a cap risks truncating the JSON nodes that
// get rendered, so we leave output length to the model.
const TEMPERATURE = 0.2;

// Web grounding: every expansion is backed by a live SearXNG search and a
// Firecrawl scrape of the top hit, so the agents reason from real evidence
// rather than their own knowledge.
const GROUND_RESULTS = 4; // SearXNG results pulled per query
const GROUND_READ_CHARS = 3500; // chars kept from the Firecrawl scrape
const FIRECRAWL_TIMEOUT_MS = 20_000; // budget for connecting + scraping

export type GoalEvent =
  | { type: "status"; status: GoalStatus }
  | { type: "init"; forward: GoalNode[]; backward: GoalNode[] }
  | {
      type: "round";
      index: number;
      max: number;
      forwardExpand: string | null;
      backwardExpand: string | null;
    }
  | { type: "nodes"; nodes: GoalNode[] }
  | { type: "reconcile"; round: number; result: ReconcileResult }
  | { type: "bridge"; bridge: BridgeResult }
  | { type: "summary"; text: string }
  | { type: "recommendations"; items: string[] }
  | {
      type: "tool";
      tool: "searxng" | "firecrawl";
      status: "running" | "done" | "error";
      /** What the tool was used for: the search query, or the scraped URL. */
      detail: string;
      /** ISO timestamp of the event. */
      at: string;
    }
  | { type: "done"; runId: string }
  | { type: "error"; message: string };

export function getLatestRun(conversationId: string): GoalRun | undefined {
  return db
    .select()
    .from(goalRuns)
    .where(eq(goalRuns.conversationId, conversationId))
    .orderBy(desc(goalRuns.createdAt))
    .limit(1)
    .get();
}

// In-flight run controllers, keyed by run id, so a cancel request can abort the
// orchestrator (and its in-flight model call). Kept on globalThis so it survives
// Next.js dev hot-reloads, like the DB client.
const globalForGoal = globalThis as unknown as {
  __goalControllers?: Map<string, AbortController>;
};
const runControllers: Map<string, AbortController> =
  globalForGoal.__goalControllers ?? new Map();
if (process.env.NODE_ENV !== "production") globalForGoal.__goalControllers = runControllers;

function isProcessing(status: GoalStatus): boolean {
  return status === "planning" || status === "expanding" || status === "reconciling";
}

/**
 * Cancels the latest still-processing run for a conversation. Aborts the live
 * orchestrator if one is registered; otherwise (e.g. after a server restart)
 * just marks the row stopped. Returns whether anything was cancelled.
 */
export function cancelRun(conversationId: string): boolean {
  const row = getLatestRun(conversationId);
  if (!row || !isProcessing(row.status)) return false;
  const controller = runControllers.get(row.id);
  if (controller) {
    controller.abort();
    return true;
  }
  db.update(goalRuns)
    .set({ status: "stalled", updatedAt: new Date().toISOString() })
    .where(eq(goalRuns.id, row.id))
    .run();
  return true;
}

/** Parsed view of a persisted run for the UI. */
export interface LoadedRun {
  id: string;
  problemSpec: string;
  startState: string;
  goalState: string;
  forward: GoalNode[];
  backward: GoalNode[];
  reconcile: ReconcileResult | null;
  bridge: BridgeResult | null;
  /** Alternative options to pursue, generated when no bridge was found. */
  recommendations: string[];
  /** Narrative of how the path goes from START to GOAL (once bridged). */
  summary: string | null;
  /** What SearXNG/Firecrawl researched during the run, and when. */
  toolLog: ToolLogEntry[];
  status: GoalStatus;
  maxRounds: number;
  error: string | null;
}

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadRun(row: GoalRun): LoadedRun {
  return {
    id: row.id,
    problemSpec: row.problemSpec,
    startState: row.startState,
    goalState: row.goalState,
    forward: safeJson<GoalNode[]>(row.forwardNodes, []),
    backward: safeJson<GoalNode[]>(row.backwardNodes, []),
    reconcile: safeJson<ReconcileResult | null>(row.reconcile, null),
    bridge: safeJson<BridgeResult | null>(row.bridge, null),
    recommendations: safeJson<string[]>(row.recommendations, []),
    summary: row.summary,
    toolLog: safeJson<ToolLogEntry[]>(row.toolLog, []),
    status: row.status,
    maxRounds: row.maxRounds,
    error: row.error,
  };
}

/**
 * Renders a finished run as a self-contained Markdown document: the problem
 * framing plus the result — the stitched START→…→GOAL bridge if one was found,
 * or the closest match and remaining gaps otherwise. Used when exporting the
 * final answer to the Editor tab.
 */
export function runToMarkdown(run: LoadedRun): { title: string; content: string } {
  const title = run.goalState.trim() || "Goal search";
  const parts: string[] = [`# ${title}`, "", "## Problem", ""];
  if (run.problemSpec.trim()) parts.push(run.problemSpec.trim(), "");
  parts.push(`**Start state:** ${run.startState.trim() || "—"}`, "");
  parts.push(`**Goal state:** ${run.goalState.trim() || "—"}`, "");

  parts.push("## Result", "");
  if (run.bridge) {
    parts.push(`**Bridge found** — total estimated cost ${run.bridge.totalCost}.`, "");
    if (run.summary) parts.push(run.summary.trim(), "");
    parts.push("**Path:**", "");
    run.bridge.path.forEach((step, i) => parts.push(`${i + 1}. ${step}`));
    parts.push("");
  } else {
    parts.push("No full bridge was found within the round budget.", "");
    if (run.reconcile?.bestPair) {
      parts.push(
        `Closest match: ${run.reconcile.bestPair.forwardId} ⨁ ${run.reconcile.bestPair.backwardId} ` +
          `(${Math.round(run.reconcile.bestPair.score * 100)}% of the goal's conditions satisfied).`,
        "",
      );
    }
    if (run.reconcile && run.reconcile.unmetConditions.length > 0) {
      parts.push("**Still unmet:**", "");
      for (const c of run.reconcile.unmetConditions) parts.push(`- ${c}`);
      parts.push("");
    }
    if (run.recommendations.length > 0) {
      parts.push("## Recommended alternatives", "");
      for (const r of run.recommendations) parts.push(`- ${r}`);
      parts.push("");
    }
  }

  return { title, content: `${parts.join("\n").trim()}\n` };
}

// --- Canvas export ---------------------------------------------------------

function canvasNodeSize(text: string, heading: boolean): { width: number; height: number } {
  const width = 224;
  if (heading) return { width, height: 54 };
  const lines = Math.ceil(Math.max(text.length, 1) / 30);
  return { width, height: Math.min(180, Math.max(60, 30 + lines * 20)) };
}

function nodeLabel(node: GoalNode): string {
  if (node.id === "F0" || node.id === "GOAL") return node.description;
  return `${node.description}\ncost ${node.costFromOrigin}`;
}

/** Walks parentIds from `startId` to the root, returning the chain of ids (node → root). */
function chainIds(startId: string, byId: Map<string, GoalNode>): string[] {
  const ids: string[] = [];
  let current = byId.get(startId);
  const guard = new Set<string>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    ids.push(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return ids;
}

/**
 * Builds a React Flow graph of the whole search — both frontiers laid out left
 * (START) to right (GOAL) — with the taken path (the stitched bridge) drawn in
 * neon-green and the rest dimmed. Deterministic: no LLM, straight from the run's
 * nodes, parent links, and bridge.
 */
export function runToCanvasGraph(run: LoadedRun): CanvasGraph {
  const fById = new Map(run.forward.map((n) => [n.id, n]));
  const bById = new Map(run.backward.map((n) => [n.id, n]));

  // Identify the nodes/edges on the taken path (only when a bridge was found).
  const pathNodes = new Set<string>();
  const pathEdges = new Set<string>();
  if (run.bridge) {
    const fChain = chainIds(run.bridge.forwardId, fById); // F … F0
    const bChain = chainIds(run.bridge.backwardId, bById); // B … GOAL
    for (const id of [...fChain, ...bChain]) pathNodes.add(id);
    // Forward edges are drawn parent→child; backward edges child→parent.
    for (let i = 0; i < fChain.length - 1; i++) pathEdges.add(`${fChain[i + 1]}->${fChain[i]}`);
    for (let i = 0; i < bChain.length - 1; i++) pathEdges.add(`${bChain[i]}->${bChain[i + 1]}`);
    pathEdges.add(`${run.bridge.forwardId}->${run.bridge.backwardId}`);
  }
  const dimEverythingElse = Boolean(run.bridge);

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 90, marginx: 24, marginy: 24 });

  const nodes: Node[] = [];
  const addNode = (gn: GoalNode, heading: boolean) => {
    const text = nodeLabel(gn);
    const size = canvasNodeSize(text, heading);
    g.setNode(gn.id, size);
    const onPath = pathNodes.has(gn.id);
    nodes.push({
      id: gn.id,
      type: heading ? "heading" : "idea",
      position: { x: 0, y: 0 },
      data: { text },
      style: dimEverythingElse
        ? onPath
          ? {
              boxShadow:
                "0 0 0 2px var(--neon-green), 0 0 18px -4px var(--neon-green)",
              borderRadius: "8px",
            }
          : { opacity: 0.45 }
        : undefined,
    });
  };

  for (const gn of run.forward) addNode(gn, gn.id === "F0");
  for (const gn of run.backward) addNode(gn, gn.id === "GOAL");

  const edges: Edge[] = [];
  const addEdge = (source: string, target: string, label?: string) => {
    if (!g.hasNode(source) || !g.hasNode(target)) return;
    const key = `${source}->${target}`;
    const onPath = pathEdges.has(key);
    g.setEdge(source, target);
    edges.push({
      id: key,
      source,
      target,
      label,
      animated: onPath,
      style: onPath
        ? { stroke: "var(--neon-green)", strokeWidth: 2.5 }
        : {
            stroke: "var(--muted-foreground)",
            strokeWidth: 1,
            opacity: dimEverythingElse ? 0.3 : 0.7,
          },
    });
  };

  // Forward tree: parent → child (F0 ends up on the left).
  for (const gn of run.forward) {
    if (gn.parentId) addEdge(gn.parentId, gn.id);
  }
  // Backward tree: child → parent (GOAL ends up on the right).
  for (const gn of run.backward) {
    if (gn.parentId) addEdge(gn.id, gn.parentId);
  }
  // The bridge connector joining the two frontiers.
  if (run.bridge) addEdge(run.bridge.forwardId, run.bridge.backwardId, "BRIDGE");

  dagre.layout(g);
  for (const node of nodes) {
    const pos = g.node(node.id);
    if (pos) node.position = { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 };
  }

  return { nodes, edges };
}

/**
 * Builds + persists a canvas of a run's search graph (taken path highlighted)
 * and returns the new canvas id.
 */
export function createRunCanvas(run: LoadedRun): string {
  const graph = runToCanvasGraph(run);
  if (graph.nodes.length === 0) throw new Error("This run has no nodes to map yet.");
  const canvas = createCanvas();
  const title = `Path · ${run.goalState.trim() || "Goal search"}`;
  renameCanvas(canvas.id, title.slice(0, 60));
  saveCanvasGraph(canvas.id, graph);
  return canvas.id;
}

// --- Prompts ---------------------------------------------------------------

/**
 * Shared anti-hallucination + brevity rules appended to every agent prompt.
 * Keeps local models grounded in the given inputs and stops them from padding
 * the output with prose, reasoning, or invented detail — which both wastes
 * tokens and pollutes the shared state schema.
 */
const GUARDRAILS =
  "\n\nRULES (follow strictly):\n" +
  "- Ground EVERYTHING in the PROBLEM SPEC, START/GOAL states, and the frontiers given to you. Do NOT invent " +
  "facts, names, numbers, tools, or steps that are not stated or clearly implied. If you are unsure, OMIT it " +
  "rather than guess — an empty array is better than a fabricated one.\n" +
  "- Output ONLY the requested JSON. No preamble, no commentary, no explanation, no markdown code fences, and " +
  "no chain-of-thought. Do not restate the inputs.\n" +
  "- Be terse. Each string is ONE short clause (aim for <12 words). Prefer fewer, high-quality items over " +
  "padding; never repeat, rephrase, or list near-duplicates. Stop as soon as the JSON is complete.";

const SCHEMA_HINT =
  "Each node is an object: " +
  '{"description": string (one line), "established_facts": string[] (what is GUARANTEED true at/after this node), ' +
  '"required_conditions": string[] (what must hold for this node to be valid/reachable), ' +
  '"cost_from_origin": number, "rationale": string}. ' +
  "Write established_facts and required_conditions in the SAME vocabulary the other agent would use — meeting detection depends on it.";

const BOOTSTRAP_SYSTEM =
  "You are seeding a bidirectional goal search. Given a problem, its START state, and its GOAL state, extract two short lists in a shared vocabulary:\n" +
  "1) start_facts: concrete things GUARANTEED true in the START state.\n" +
  "2) goal_conditions: the conditions that must hold for the GOAL to be satisfied.\n" +
  'Return ONLY a JSON object: {"start_facts": string[], "goal_conditions": string[]}. 2–5 items each, each a short self-contained clause.' +
  GUARDRAILS;

function forwardSystem(maxNew: number): string {
  return (
    "You are the FORWARD agent in a bidirectional search. You build a solution path FORWARD from the START " +
    "state toward the GOAL, ONE bounded expansion per round. A 'step' is the smallest meaningful operation " +
    "in this problem domain — do NOT leap to the goal.\n" +
    "Take the most DIRECT, lowest-cost next step that makes real progress toward the GOAL. Do NOT over-think " +
    "or over-engineer: return a SINGLE best next node when there is one obvious step; only return up to " +
    `${maxNew} nodes when there are genuinely DISTINCT, viable alternative next steps worth exploring separately.\n` +
    "Stay in your lane: think ONLY about moving forward toward the goal. Do NOT try to anticipate the backward " +
    "side, guess where the paths will meet, or shape your facts to match it — detecting the meeting point is the " +
    "RECONCILER's job, not yours. If the reconciler gave a hint about which facts to establish next, pursue them " +
    "the most efficient way.\n" +
    "You are given EVIDENCE retrieved LIVE from SearXNG web search plus a Firecrawl page scrape. Base every " +
    "established_fact ONLY on that evidence and the problem inputs — do NOT use your own prior knowledge or " +
    "invent facts. If the evidence is thin, keep facts minimal and flag uncertainty; never fabricate.\n" +
    "Assign honest cost_from_origin = parent cost + step effort (1 = trivial, higher = harder).\n" +
    `OUTPUT: a JSON array of new forward nodes, nothing else. ${SCHEMA_HINT}` +
    GUARDRAILS
  );
}

function backwardSystem(maxNew: number): string {
  return (
    "You are the BACKWARD agent in a bidirectional search. You work BACKWARD from the GOAL toward the START, " +
    "exposing the preconditions that must hold for the goal to be reachable — ONE regression layer per round.\n" +
    `For the node you were asked to regress, answer: "What must be TRUE immediately BEFORE this state, such ` +
    'that one step produces it?" Take the most DIRECT regression: return a SINGLE best predecessor when there ' +
    `is one obvious one; only return up to ${maxNew} when there are genuinely DISTINCT, viable predecessors. Do ` +
    "NOT over-think or invent elaborate preconditions. Each predecessor's required_conditions are its own " +
    "preconditions; its established_facts are what it guarantees (which should match the child's preconditions).\n" +
    "Stay in your lane: think ONLY about regressing toward the start. Do NOT try to anticipate the forward side, " +
    "guess where the paths will meet, or shape your conditions to match it — that is the RECONCILER's job. If the " +
    "reconciler gave a hint about which preconditions to relax/regress, follow it efficiently.\n" +
    "You are given EVIDENCE retrieved LIVE from SearXNG web search plus a Firecrawl page scrape. Base your " +
    "preconditions and facts ONLY on that evidence and the problem inputs — do NOT use your own prior knowledge " +
    "or invent facts. If the evidence is thin, keep them minimal and flag uncertainty; never fabricate.\n" +
    "cost_from_origin = child cost + regression-step effort, measured FROM GOAL.\n" +
    `OUTPUT: a JSON array of new backward nodes, nothing else. ${SCHEMA_HINT}` +
    GUARDRAILS
  );
}

const RECONCILER_SYSTEM =
  "You are the RECONCILER in a bidirectional search — the ONLY component that compares the two frontiers. The " +
  "forward and backward agents work independently; your job is to find where they are CLOSEST and steer them to " +
  "meet by the most EFFICIENT (lowest combined cost) route.\n" +
  "1) For every (F, B) pair, judge how well F.established_facts satisfy B.required_conditions; score 0.0–1.0.\n" +
  "2) Pick the best pair — the one closest to meeting; on ties prefer the LOWEST combined cost_from_origin.\n" +
  "3) bridge_found = true ONLY if EVERY required_condition of B is satisfied by F (score ~1.0, no critical gap).\n" +
  "4) If NOT found, list exactly which of that pair's required_conditions are still unmet. Then give ONE focused " +
  "hint to the FORWARD agent (the single highest-leverage fact to establish next) and ONE to the BACKWARD agent " +
  "(the single precondition to relax/regress next) that most cheaply closes the gap. Point at the one thing that " +
  "matters most — not a laundry list.\n" +
  'OUTPUT JSON ONLY: {"best_pair": {"forward_id": string, "backward_id": string, "score": number}, ' +
  '"bridge_found": boolean, "unmet_conditions": string[], "hint_to_forward": string, "hint_to_backward": string}.' +
  GUARDRAILS;

const RECOMMEND_SYSTEM =
  "You are an advisor wrapping up a bidirectional goal search that did NOT find a complete path within budget. " +
  "Given the problem, the START/GOAL states, the forward and backward frontiers reached, and the conditions " +
  "still unmet, suggest concrete ALTERNATIVE options the user could pursue to make the goal reachable. Good " +
  "options: relax or change a specific blocking constraint, acquire a missing resource/precondition, take a " +
  "different approach for the unmet part, split the goal into a more reachable sub-goal, or adjust the goal " +
  "itself. Each option must be specific and actionable, tied to what actually blocked this search.\n" +
  "Return ONLY a JSON array of 3–5 short option strings." +
  GUARDRAILS;

const SUMMARY_SYSTEM =
  "You are summarizing how a bidirectional search connected a START state to a GOAL. You are given the problem, " +
  "the start and goal, and the ordered stitched path (START → … → GOAL). Write a SHORT, clear narrative " +
  "(3–6 sentences) of how the solution gets from start to end and why each major step follows from the last. " +
  "Base it ONLY on the given path and inputs — do not invent steps. Plain prose: no preamble, no markdown " +
  "headings, no bullet list, no restating the path verbatim.";

// --- Web grounding (SearXNG + Firecrawl) -----------------------------------

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

/** Extracts the text parts from an MCP tool result. */
function mcpResultText(result: unknown): string {
  const r = result as { content?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(r?.content)) return "";
  return r.content
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n")
    .trim();
}

/**
 * Scrapes a URL via the configured Firecrawl MCP server. Connects on demand and
 * picks the server's scrape tool by name. Throws (caught by the caller) if no
 * Firecrawl server/tool is available or the call times out.
 */
async function firecrawlScrape(url: string): Promise<string> {
  try {
    syncMcpServersFromFile();
  } catch {
    // a bad mcp.json must not break grounding
  }
  const server = db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.enabled, true))
    .all()
    .find((s) => /firecrawl/i.test(s.name));
  if (!server) throw new Error("No enabled Firecrawl MCP server is configured.");

  const conn = await raceTimeout(connectServer(server), FIRECRAWL_TIMEOUT_MS);
  if (conn.status !== "connected") {
    throw new Error(conn.error ?? "Firecrawl MCP server is not connected.");
  }
  const tool =
    conn.tools.find((t) => /scrape/i.test(t.name)) ??
    conn.tools.find((t) => /(extract|read|fetch)/i.test(t.name));
  if (!tool) throw new Error("Firecrawl MCP server exposes no scrape tool.");

  const result = await raceTimeout(
    callMcpTool(server.id, tool.name, {
      url,
      formats: ["markdown"],
      onlyMainContent: true,
    }),
    FIRECRAWL_TIMEOUT_MS,
  );
  return mcpResultText(result).slice(0, GROUND_READ_CHARS);
}

/** Formats search results + a scraped page into an EVIDENCE block for an agent. */
function buildEvidence(results: SearchResult[], scraped: string, scrapedUrl: string): string {
  if (results.length === 0 && !scraped) {
    return "(no web evidence could be retrieved this step — do NOT fabricate; keep any facts minimal and flagged as uncertain)";
  }
  const lines: string[] = [];
  if (results.length > 0) {
    lines.push("Search results (SearXNG):");
    results.forEach((r, i) => lines.push(`[${i + 1}] ${r.title} — ${r.url}\n${r.snippet}`));
  }
  if (scraped) {
    lines.push(`\nScraped page (Firecrawl) — ${scrapedUrl}:\n${scraped}`);
  }
  return lines.join("\n");
}

/**
 * Grounds one expansion: runs a SearXNG search, scrapes the top hit with
 * Firecrawl, and returns an EVIDENCE block. Yields tool-activity events (for the
 * UI windows) and returns the evidence string. Best-effort — failures degrade to
 * whatever evidence was gathered.
 */
async function* groundQuery(
  query: string,
  log: ToolLogEntry[],
): AsyncGenerator<GoalEvent, string> {
  const q = query.trim().replace(/\s+/g, " ").slice(0, 300);
  if (!q) return buildEvidence([], "", "");

  // Records a finished action in the persisted log and emits a matching event.
  const finish = (
    tool: ToolLogEntry["tool"],
    status: ToolLogEntry["status"],
    detail: string,
  ): GoalEvent => {
    const at = new Date().toISOString();
    log.push({ tool, detail, status, at });
    return { type: "tool", tool, status, detail, at };
  };
  const now = () => new Date().toISOString();

  yield { type: "tool", tool: "searxng", status: "running", detail: q, at: now() };
  let results: SearchResult[] = [];
  try {
    results = await searxngSearch(q, GROUND_RESULTS);
    yield finish("searxng", "done", q);
  } catch {
    yield finish("searxng", "error", q);
  }

  let scraped = "";
  const top = results.find((r) => r.url);
  if (top?.url) {
    yield { type: "tool", tool: "firecrawl", status: "running", detail: top.url, at: now() };
    try {
      scraped = await firecrawlScrape(top.url);
      yield finish("firecrawl", "done", top.url);
    } catch {
      yield finish("firecrawl", "error", top.url);
    }
  }
  return buildEvidence(results, scraped, top?.url ?? "");
}

// --- Tolerant parsing ------------------------------------------------------

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

function extractJson(text: string, open: "{" | "["): unknown {
  const close = open === "{" ? "}" : "]";
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

interface RawNode {
  description?: unknown;
  established_facts?: unknown;
  required_conditions?: unknown;
  cost_from_origin?: unknown;
  rationale?: unknown;
}

/** Turns an agent's JSON array into validated GoalNodes, assigning ids + parent + cost. */
function parseNewNodes(
  text: string,
  side: GoalSide,
  parent: GoalNode,
  nextId: () => string,
): GoalNode[] {
  const arr = extractJson(text, "[");
  if (!Array.isArray(arr)) return [];
  const out: GoalNode[] = [];
  for (const item of arr.slice(0, MAX_NEW_PER_EXPANSION)) {
    if (!item || typeof item !== "object") continue;
    const raw = item as RawNode;
    const description = typeof raw.description === "string" ? raw.description.trim() : "";
    if (!description) continue;
    const cost =
      typeof raw.cost_from_origin === "number" && raw.cost_from_origin >= parent.costFromOrigin
        ? raw.cost_from_origin
        : parent.costFromOrigin + 1;
    out.push({
      id: nextId(),
      side,
      parentId: parent.id,
      description,
      establishedFacts: toStringArray(raw.established_facts),
      requiredConditions: toStringArray(raw.required_conditions),
      costFromOrigin: cost,
      rationale: typeof raw.rationale === "string" ? raw.rationale.trim() : "",
      expanded: false,
    });
  }
  return out;
}

interface RawReconcile {
  best_pair?: { forward_id?: unknown; backward_id?: unknown; score?: unknown };
  bridge_found?: unknown;
  unmet_conditions?: unknown;
  hint_to_forward?: unknown;
  hint_to_backward?: unknown;
}

function parseReconcile(
  text: string,
  forward: GoalNode[],
  backward: GoalNode[],
): ReconcileResult {
  const empty: ReconcileResult = {
    bestPair: null,
    bridgeFound: false,
    unmetConditions: [],
    hintToForward: "",
    hintToBackward: "",
    totalCost: null,
  };
  const obj = extractJson(text, "{") as RawReconcile | null;
  if (!obj) return empty;

  const fId = typeof obj.best_pair?.forward_id === "string" ? obj.best_pair.forward_id : null;
  const bId = typeof obj.best_pair?.backward_id === "string" ? obj.best_pair.backward_id : null;
  const fNode = fId ? forward.find((n) => n.id === fId) : undefined;
  const bNode = bId ? backward.find((n) => n.id === bId) : undefined;
  const score =
    typeof obj.best_pair?.score === "number"
      ? Math.max(0, Math.min(1, obj.best_pair.score))
      : 0;

  const bestPair =
    fNode && bNode ? { forwardId: fNode.id, backwardId: bNode.id, score } : null;
  const bridgeFound = obj.bridge_found === true && bestPair !== null;

  return {
    bestPair,
    bridgeFound,
    unmetConditions: toStringArray(obj.unmet_conditions),
    hintToForward: typeof obj.hint_to_forward === "string" ? obj.hint_to_forward.trim() : "",
    hintToBackward: typeof obj.hint_to_backward === "string" ? obj.hint_to_backward.trim() : "",
    totalCost:
      bestPair && fNode && bNode ? fNode.costFromOrigin + bNode.costFromOrigin : null,
  };
}

// --- Frontier helpers ------------------------------------------------------

/** Serializes a frontier compactly for an agent prompt (drops bookkeeping). */
function frontierForPrompt(nodes: GoalNode[]): string {
  return JSON.stringify(
    nodes.map((n) => ({
      id: n.id,
      parent_id: n.parentId,
      description: n.description,
      established_facts: n.establishedFacts,
      required_conditions: n.requiredConditions,
      cost_from_origin: n.costFromOrigin,
    })),
    null,
    1,
  );
}

/** Cheapest unexpanded node on a side, or undefined when the frontier is exhausted. */
function cheapestUnexpanded(nodes: GoalNode[]): GoalNode | undefined {
  return nodes
    .filter((n) => !n.expanded)
    .sort((a, b) => a.costFromOrigin - b.costFromOrigin)[0];
}

/**
 * Beam prune: keep every expanded node (they form the tree + supply facts) plus
 * the cheapest BEAM_WIDTH unexpanded nodes; drop the rest to bound blow-up.
 */
function prune(nodes: GoalNode[]): GoalNode[] {
  const expanded = nodes.filter((n) => n.expanded);
  const unexpanded = nodes
    .filter((n) => !n.expanded)
    .sort((a, b) => a.costFromOrigin - b.costFromOrigin)
    .slice(0, BEAM_WIDTH);
  return [...expanded, ...unexpanded];
}

/** Walks parentIds to the root, returning descriptions root→node. */
function pathToRoot(node: GoalNode, byId: Map<string, GoalNode>): string[] {
  const chain: string[] = [];
  let current: GoalNode | undefined = node;
  const guard = new Set<string>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    chain.push(current.description);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain.reverse();
}

function buildBridge(
  result: ReconcileResult,
  forward: GoalNode[],
  backward: GoalNode[],
): BridgeResult | null {
  if (!result.bestPair) return null;
  const fNode = forward.find((n) => n.id === result.bestPair!.forwardId);
  const bNode = backward.find((n) => n.id === result.bestPair!.backwardId);
  if (!fNode || !bNode) return null;
  const forwardPath = pathToRoot(fNode, new Map(forward.map((n) => [n.id, n]))); // START → F
  const backwardPath = pathToRoot(bNode, new Map(backward.map((n) => [n.id, n]))); // GOAL → B
  // backwardPath is GOAL → … → B; reverse it to get B → … → GOAL.
  const tail = [...backwardPath].reverse();
  return {
    forwardId: fNode.id,
    backwardId: bNode.id,
    totalCost: fNode.costFromOrigin + bNode.costFromOrigin,
    path: [...forwardPath, ...tail],
  };
}

/**
 * When the search ends without a bridge, asks the model for concrete alternative
 * options to pursue (relax a constraint, get a missing resource, change the
 * approach/goal). Best-effort: returns [] on any failure.
 */
async function buildRecommendations(
  model: LanguageModel,
  context: string,
  forward: GoalNode[],
  backward: GoalNode[],
  unmet: string[],
): Promise<string[]> {
  const prompt =
    `${context}\n\nFORWARD FRONTIER:\n${frontierForPrompt(forward)}\n\n` +
    `BACKWARD FRONTIER:\n${frontierForPrompt(backward)}\n\n` +
    `CONDITIONS STILL UNMET:\n${
      unmet.length ? unmet.map((u) => `- ${u}`).join("\n") : "(the frontiers never overlapped)"
    }`;
  try {
    const { text } = await generateText({
      model,
      system: RECOMMEND_SYSTEM,
      prompt,
      temperature: TEMPERATURE,
    });
    const arr = extractJson(text, "[");
    if (Array.isArray(arr)) return toStringArray(arr).slice(0, 5);
  } catch {
    // best-effort — no recommendations on failure
  }
  return [];
}

// --- Orchestrator ----------------------------------------------------------

/**
 * Runs the full bidirectional goal-convergence loop as an async event stream,
 * persisting a `goal_runs` row throughout. Bootstraps the two roots, then each
 * round expands the cheapest unexpanded node on each side (forward + backward in
 * parallel), reconciles the frontiers, and stops on bridge / stall / round cap.
 */
export async function* runBidirectional(opts: {
  conversationId: string;
  problemSpec: string;
  startState: string;
  goalState: string;
  model: LanguageModel;
  maxRounds?: number;
}): AsyncGenerator<GoalEvent> {
  const { conversationId, problemSpec, startState, goalState, model } = opts;
  const maxRounds = Math.min(
    GOAL_ROUNDS_MAX,
    Math.max(GOAL_ROUNDS_MIN, opts.maxRounds ?? DEFAULT_GOAL_ROUNDS),
  );
  const now = new Date().toISOString();
  const runId = randomUUID();

  db.insert(goalRuns)
    .values({
      id: runId,
      conversationId,
      problemSpec,
      startState,
      goalState,
      maxRounds,
      status: "planning",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const touch = (patch: Partial<GoalRun>) =>
    db
      .update(goalRuns)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(goalRuns.id, runId))
      .run();

  let forward: GoalNode[] = [];
  let backward: GoalNode[] = [];
  let fCounter = 0;
  let bCounter = 0;
  const nextForwardId = () => `F${++fCounter}`;
  const nextBackwardId = () => `B${++bCounter}`;
  const toolLog: ToolLogEntry[] = [];

  const context = `PROBLEM SPEC:\n${problemSpec}\n\nSTART STATE:\n${startState}\n\nGOAL STATE:\n${goalState}`;

  const persist = (status: GoalStatus, extra: Partial<GoalRun> = {}) =>
    touch({
      status,
      toolLog: JSON.stringify(toolLog),
      forwardNodes: JSON.stringify(forward),
      backwardNodes: JSON.stringify(backward),
      ...extra,
    });

  // Register a controller so a cancel request can abort this run + its model call.
  const controller = new AbortController();
  const abortSignal = controller.signal;
  runControllers.set(runId, controller);

  try {
    // 1) Bootstrap the two roots --------------------------------------------
    yield { type: "status", status: "planning" };
    let startFacts: string[] = [startState].filter(Boolean);
    let goalConditions: string[] = [goalState].filter(Boolean);
    try {
      const { text } = await generateText({
        model,
        system: BOOTSTRAP_SYSTEM,
        prompt: context,
        temperature: TEMPERATURE,
        abortSignal,
      });
      const obj = extractJson(text, "{") as
        | { start_facts?: unknown; goal_conditions?: unknown }
        | null;
      const sf = toStringArray(obj?.start_facts);
      const gc = toStringArray(obj?.goal_conditions);
      if (sf.length) startFacts = sf;
      if (gc.length) goalConditions = gc;
    } catch {
      // Keep the raw-state fallback.
    }

    forward = [
      {
        id: "F0",
        side: "forward",
        parentId: null,
        description: startState || "Start state",
        establishedFacts: startFacts,
        requiredConditions: [],
        costFromOrigin: 0,
        rationale: "Initial state.",
        expanded: false,
      },
    ];
    backward = [
      {
        id: "GOAL",
        side: "backward",
        parentId: null,
        description: goalState || "Goal state",
        establishedFacts: [],
        requiredConditions: goalConditions,
        costFromOrigin: 0,
        rationale: "Target state.",
        expanded: false,
      },
    ];
    persist("planning");
    yield { type: "init", forward, backward };

    let hintForward = "";
    let hintBackward = "";
    let bestScore = -1;
    let stalls = 0;
    let lastResult: ReconcileResult | null = null;

    // Shared no-bridge ending: recommend alternative options to pursue, then stop.
    async function* finishStalled(): AsyncGenerator<GoalEvent> {
      yield { type: "status", status: "stalled" };
      const recommendations = await buildRecommendations(
        model,
        context,
        forward,
        backward,
        lastResult?.unmetConditions ?? [],
      );
      persist("stalled", { recommendations: JSON.stringify(recommendations) });
      if (recommendations.length > 0) yield { type: "recommendations", items: recommendations };
      yield { type: "done", runId };
    }

    // 2) Rounds --------------------------------------------------------------
    for (let round = 1; round <= maxRounds; round++) {
      if (abortSignal.aborted) break; // cancelled between rounds
      const fExpand = cheapestUnexpanded(forward);
      const bExpand = cheapestUnexpanded(backward);
      if (!fExpand && !bExpand) break; // both frontiers exhausted

      yield { type: "status", status: "expanding" };
      yield {
        type: "round",
        index: round,
        max: maxRounds,
        forwardExpand: fExpand?.id ?? null,
        backwardExpand: bExpand?.id ?? null,
      };

      // Ground each expansion in live web evidence (SearXNG + Firecrawl) before
      // the agent reasons, so it builds on real sources instead of its own memory.
      let fEvidence = "";
      let bEvidence = "";
      if (fExpand) {
        fEvidence = yield* groundQuery(`${fExpand.description} ${hintForward}`, toolLog);
      }
      if (bExpand && !abortSignal.aborted) {
        bEvidence = yield* groundQuery(`${bExpand.description} ${hintBackward}`, toolLog);
      }

      const [fText, bText] = await Promise.all([
        fExpand
          ? generateText({
              model,
              system: forwardSystem(MAX_NEW_PER_EXPANSION),
              prompt:
                `${context}\n\nYOUR CURRENT FORWARD FRONTIER:\n${frontierForPrompt(forward)}\n\n` +
                `RECONCILER HINT (facts to establish next): ${hintForward || "(none yet)"}\n\n` +
                `EVIDENCE (live SearXNG + Firecrawl — base your facts ONLY on this):\n${fEvidence}\n\n` +
                `EXPAND THIS NODE: ${fExpand.id} — ${fExpand.description}`,
              temperature: TEMPERATURE,
              abortSignal,
            }).then((r) => r.text)
          : Promise.resolve(""),
        bExpand
          ? generateText({
              model,
              system: backwardSystem(MAX_NEW_PER_EXPANSION),
              prompt:
                `${context}\n\nYOUR CURRENT BACKWARD FRONTIER (GOAL is the root):\n${frontierForPrompt(backward)}\n\n` +
                `RECONCILER HINT (preconditions to relax/regress next): ${hintBackward || "(none yet)"}\n\n` +
                `EVIDENCE (live SearXNG + Firecrawl — base your facts ONLY on this):\n${bEvidence}\n\n` +
                `REGRESS THIS NODE: ${bExpand.id} — ${bExpand.description}`,
              temperature: TEMPERATURE,
              abortSignal,
            }).then((r) => r.text)
          : Promise.resolve(""),
      ]);

      const newNodes: GoalNode[] = [];
      if (fExpand) {
        fExpand.expanded = true;
        const children = parseNewNodes(fText, "forward", fExpand, nextForwardId);
        forward.push(...children);
        newNodes.push(...children);
      }
      if (bExpand) {
        bExpand.expanded = true;
        const children = parseNewNodes(bText, "backward", bExpand, nextBackwardId);
        backward.push(...children);
        newNodes.push(...children);
      }

      forward = prune(forward);
      backward = prune(backward);
      persist("expanding");
      yield { type: "nodes", nodes: newNodes };

      // 2b) Reconcile -------------------------------------------------------
      yield { type: "status", status: "reconciling" };
      let result: ReconcileResult = {
        bestPair: null,
        bridgeFound: false,
        unmetConditions: [],
        hintToForward: "",
        hintToBackward: "",
        totalCost: null,
      };
      try {
        const { text } = await generateText({
          model,
          system: RECONCILER_SYSTEM,
          temperature: TEMPERATURE,
          abortSignal,
          prompt:
            `${context}\n\nFORWARD FRONTIER:\n${frontierForPrompt(forward)}\n\n` +
            `BACKWARD FRONTIER:\n${frontierForPrompt(backward)}`,
        });
        result = parseReconcile(text, forward, backward);
      } catch {
        // keep the empty result; the loop continues with no new hints
      }

      persist("reconciling", { reconcile: JSON.stringify(result) });
      yield { type: "reconcile", round, result };
      lastResult = result;

      if (result.bridgeFound) {
        const bridge = buildBridge(result, forward, backward);
        if (bridge) {
          persist("done", {
            reconcile: JSON.stringify(result),
            bridge: JSON.stringify(bridge),
          });
          yield { type: "bridge", bridge };

          // Summarize how the path gets from START to GOAL.
          let summary = "";
          try {
            const { text } = await generateText({
              model,
              system: SUMMARY_SYSTEM,
              prompt:
                `${context}\n\nSTITCHED PATH (START → … → GOAL):\n` +
                bridge.path.map((step, i) => `${i + 1}. ${step}`).join("\n"),
              temperature: TEMPERATURE,
              abortSignal,
            });
            summary = text.trim();
          } catch {
            // best-effort — the bridge stands on its own without a summary
          }
          if (summary) {
            touch({ summary });
            yield { type: "summary", text: summary };
          }

          yield { type: "status", status: "done" };
          yield { type: "done", runId };
          return;
        }
      }

      // Stall detection: best score not improving.
      const score = result.bestPair?.score ?? 0;
      if (score > bestScore + 0.01) {
        bestScore = score;
        stalls = 0;
      } else {
        stalls += 1;
      }

      hintForward = result.hintToForward;
      hintBackward = result.hintToBackward;

      if (stalls >= STALL_ROUNDS) {
        yield* finishStalled();
        return;
      }
    }

    // 3) Cancelled, or round cap / exhausted frontiers reached without a bridge.
    if (abortSignal.aborted) {
      persist("stalled");
      yield { type: "status", status: "stalled" };
      yield { type: "done", runId };
    } else {
      yield* finishStalled();
    }
  } catch (err) {
    // An abort (cancel) surfaces here as an error from the in-flight model call —
    // treat it as a graceful stop, not a failure.
    if (abortSignal.aborted) {
      try {
        persist("stalled");
      } catch {
        // ignore — best-effort
      }
      yield { type: "status", status: "stalled" };
      yield { type: "done", runId };
    } else {
      const message = err instanceof Error ? err.message : String(err);
      touch({ status: "error", error: message });
      yield { type: "error", message };
    }
  } finally {
    runControllers.delete(runId);
  }
}
