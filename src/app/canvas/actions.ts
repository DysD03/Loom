"use server";

import { revalidatePath } from "next/cache";

import {
  createCanvas,
  deleteCanvas,
  renameCanvas,
  saveCanvasGraph,
  type CanvasGraph,
} from "@/lib/canvas";
import { seedCanvasFromSource, type SeedKind } from "@/lib/seed";

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
