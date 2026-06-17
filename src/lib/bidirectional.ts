import "server-only";

import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { generateText, type LanguageModel } from "ai";

import { db } from "@/db/client";
import { goalRuns, type GoalRun, type GoalStatus } from "@/db/schema";
import {
  DEFAULT_GOAL_ROUNDS,
  GOAL_ROUNDS_MAX,
  GOAL_ROUNDS_MIN,
  type BridgeResult,
  type GoalNode,
  type GoalSide,
  type ReconcileResult,
} from "./bidirectional-config";

export type {
  BridgeResult,
  GoalNode,
  GoalSide,
  ReconcileResult,
} from "./bidirectional-config";

// Search sizing — bounded so the running context fits a local model. Each round
// expands the cheapest unexpanded node on each side (Dijkstra-style), then the
// reconciler checks for a meeting. Beam pruning caps frontier blow-up.
const BEAM_WIDTH = 6; // cheapest unexpanded nodes kept per side
const MAX_NEW_PER_EXPANSION = 3; // 1–3 children per expansion (per the spec)
const STALL_ROUNDS = 3; // stop if the best reconciler score hasn't improved for this many rounds

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
    status: row.status,
    maxRounds: row.maxRounds,
    error: row.error,
  };
}

// --- Prompts ---------------------------------------------------------------

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
  'Return ONLY a JSON object: {"start_facts": string[], "goal_conditions": string[]}. 2–5 items each, each a short self-contained sentence.';

function forwardSystem(maxNew: number): string {
  return (
    "You are the FORWARD agent in a bidirectional search. You build a solution path FORWARD from the START " +
    "state toward the GOAL, ONE bounded expansion per round. A 'step' is the smallest meaningful operation " +
    "in this problem domain — do NOT leap to the goal.\n" +
    `Produce 1–${maxNew} NEW forward nodes, each exactly one bounded step beyond the node you were asked to expand. ` +
    "PREFER expansions whose established_facts satisfy one or more of the backward agent's required_conditions " +
    "(this pulls you to the middle). Assign honest cost_from_origin = parent cost + step effort (1 = trivial, " +
    "higher = harder). Only list facts you can actually guarantee.\n" +
    `OUTPUT: a JSON array of new forward nodes, nothing else. ${SCHEMA_HINT}`
  );
}

function backwardSystem(maxNew: number): string {
  return (
    "You are the BACKWARD agent in a bidirectional search. You work BACKWARD from the GOAL, exposing the " +
    "preconditions that must hold for the goal to be reachable — ONE regression layer per round.\n" +
    `For the node you were asked to regress, answer: "What must be TRUE immediately BEFORE this state, such ` +
    `that one step produces it?" Produce 1–${maxNew} predecessor nodes. Each predecessor's required_conditions ` +
    "are its own preconditions; its established_facts are what it guarantees (which should match the child's " +
    "preconditions). PREFER predecessors whose required_conditions are plausibly satisfiable by the forward " +
    "agent's current established_facts. cost_from_origin = child cost + regression-step effort, measured FROM GOAL.\n" +
    `OUTPUT: a JSON array of new backward nodes, nothing else. ${SCHEMA_HINT}`
  );
}

const RECONCILER_SYSTEM =
  "You are the RECONCILER in a bidirectional search. Each round you check whether the forward and backward " +
  "frontiers have met, and you emit guidance for both agents.\n" +
  "1) For every (F, B) pair, judge how well F.established_facts satisfy B.required_conditions; score 0.0–1.0.\n" +
  "2) Pick the best pair (highest score).\n" +
  "3) bridge_found = true ONLY if EVERY required_condition of B is satisfied by F (score ~1.0, no critical gap).\n" +
  "4) If NOT found, state exactly which of B's required_conditions are still unmet, and give one hint telling the " +
  "FORWARD agent which facts to establish and one telling the BACKWARD agent which preconditions to relax/regress.\n" +
  'OUTPUT JSON ONLY: {"best_pair": {"forward_id": string, "backward_id": string, "score": number}, ' +
  '"bridge_found": boolean, "unmet_conditions": string[], "hint_to_forward": string, "hint_to_backward": string}.';

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

  const context = `PROBLEM SPEC:\n${problemSpec}\n\nSTART STATE:\n${startState}\n\nGOAL STATE:\n${goalState}`;

  const persist = (status: GoalStatus, extra: Partial<GoalRun> = {}) =>
    touch({
      status,
      forwardNodes: JSON.stringify(forward),
      backwardNodes: JSON.stringify(backward),
      ...extra,
    });

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

    // 2) Rounds --------------------------------------------------------------
    for (let round = 1; round <= maxRounds; round++) {
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

      const [fText, bText] = await Promise.all([
        fExpand
          ? generateText({
              model,
              system: forwardSystem(MAX_NEW_PER_EXPANSION),
              prompt:
                `${context}\n\nYOUR CURRENT FORWARD FRONTIER:\n${frontierForPrompt(forward)}\n\n` +
                `BACKWARD AGENT'S EXPOSED SUB-GOALS (steer toward these):\n${frontierForPrompt(backward)}\n\n` +
                `RECONCILER HINT (facts to establish): ${hintForward || "(none yet)"}\n\n` +
                `EXPAND THIS NODE: ${fExpand.id} — ${fExpand.description}`,
            }).then((r) => r.text)
          : Promise.resolve(""),
        bExpand
          ? generateText({
              model,
              system: backwardSystem(MAX_NEW_PER_EXPANSION),
              prompt:
                `${context}\n\nYOUR CURRENT BACKWARD FRONTIER (GOAL is the root):\n${frontierForPrompt(backward)}\n\n` +
                `FORWARD AGENT'S ACHIEVED FACTS (regress toward what is reachable):\n${frontierForPrompt(forward)}\n\n` +
                `RECONCILER HINT (preconditions to relax/regress): ${hintBackward || "(none yet)"}\n\n` +
                `REGRESS THIS NODE: ${bExpand.id} — ${bExpand.description}`,
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

      if (result.bridgeFound) {
        const bridge = buildBridge(result, forward, backward);
        if (bridge) {
          persist("done", {
            reconcile: JSON.stringify(result),
            bridge: JSON.stringify(bridge),
          });
          yield { type: "bridge", bridge };
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
        persist("stalled");
        yield { type: "status", status: "stalled" };
        yield { type: "done", runId };
        return;
      }
    }

    // 3) Round cap reached without a bridge ---------------------------------
    persist("stalled");
    yield { type: "status", status: "stalled" };
    yield { type: "done", runId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    touch({ status: "error", error: message });
    yield { type: "error", message };
  }
}
