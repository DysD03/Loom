/**
 * Pure configuration constants + shared types for the Bidirectional
 * Goal-Convergence agents (the Experimental Agent surface). No server-only deps,
 * so both the client view and the server orchestrator can import this.
 */

export const GOAL_ROUNDS_MIN = 1;
export const GOAL_ROUNDS_MAX = 12;
export const DEFAULT_GOAL_ROUNDS = 6;

/** Which side of the search a frontier node belongs to. */
export type GoalSide = "forward" | "backward";

/**
 * A frontier node in the shared state schema. Forward `establishedFacts` and
 * backward `requiredConditions` are written in the same vocabulary — meeting
 * detection depends on it.
 */
export interface GoalNode {
  /** Side prefix + counter, e.g. "F3" / "B2"; the forward root is "F0", the backward root "GOAL". */
  id: string;
  side: GoalSide;
  /** Parent on this side, or null for a root. */
  parentId: string | null;
  /** One-line state summary. */
  description: string;
  /** What is GUARANTEED true at/after this node (forward) or what it provides (backward). */
  establishedFacts: string[];
  /** What must hold for this node to be valid/reachable. */
  requiredConditions: string[];
  /** Forward: effort from START. Backward: effort from GOAL. */
  costFromOrigin: number;
  /** Why this expansion. */
  rationale: string;
  /** Orchestrator bookkeeping: has this node already been expanded? */
  expanded: boolean;
}

/** The reconciler's verdict for one round. */
export interface ReconcileResult {
  bestPair: { forwardId: string; backwardId: string; score: number } | null;
  bridgeFound: boolean;
  totalCost: number | null;
  unmetConditions: string[];
  hintToForward: string;
  hintToBackward: string;
}

/** One logged grounding action — a SearXNG search or a Firecrawl scrape. */
export interface ToolLogEntry {
  tool: "searxng" | "firecrawl";
  /** The search query or the scraped URL. */
  detail: string;
  status: "done" | "error";
  /** ISO timestamp of when it completed. */
  at: string;
}

/** A completed bridge: the stitched path from START to GOAL. */
export interface BridgeResult {
  forwardId: string;
  backwardId: string;
  totalCost: number;
  /** Ordered node descriptions: START → … → F → B → … → GOAL. */
  path: string[];
}
