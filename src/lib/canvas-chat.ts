/**
 * Shared types for the "Talk to Canvas" chat — a board-aware assistant that can
 * both answer questions about the canvas and edit it. No server-only deps so the
 * client component and the server action can both import it (server actions can't
 * export types themselves).
 */

/** A single edit the model wants to apply to the board. */
export type CanvasOp =
  | { op: "add"; id: string; nodeType: "idea" | "heading"; text: string }
  | { op: "connect"; source: string; target: string }
  | { op: "rename"; id: string; text: string }
  | { op: "remove"; id: string };

/** A compact view of the current board passed to the model. */
export interface CanvasGraphView {
  nodes: { id: string; type: string; text: string }[];
  edges: { source: string; target: string }[];
}

export interface CanvasChatMessage {
  role: "user" | "assistant";
  content: string;
}
