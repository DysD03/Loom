import "server-only";

import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Edge, Node } from "@xyflow/react";

import { db } from "@/db/client";
import { canvases, type Canvas } from "@/db/schema";

const TITLE_MAX = 60;

export interface CanvasGraph {
  nodes: Node[];
  edges: Edge[];
}

export function listCanvases(): Canvas[] {
  return db.select().from(canvases).orderBy(desc(canvases.updatedAt)).all();
}

export function getCanvas(id: string): Canvas | undefined {
  return db.select().from(canvases).where(eq(canvases.id, id)).get();
}

export function createCanvas(): Canvas {
  return db.insert(canvases).values({ id: randomUUID() }).returning().get();
}

export function deleteCanvas(id: string): void {
  db.delete(canvases).where(eq(canvases.id, id)).run();
}

export function renameCanvas(id: string, title: string): void {
  const trimmed = title.trim().slice(0, TITLE_MAX) || "Untitled canvas";
  db.update(canvases)
    .set({ title: trimmed, updatedAt: new Date().toISOString() })
    .where(eq(canvases.id, id))
    .run();
}

export function saveCanvasGraph(id: string, graph: CanvasGraph): void {
  db.update(canvases)
    .set({
      nodes: JSON.stringify(graph.nodes ?? []),
      edges: JSON.stringify(graph.edges ?? []),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(canvases.id, id))
    .run();
}

/** Parses a stored canvas into typed nodes/edges (tolerant of corrupt JSON). */
export function loadCanvasGraph(row: Canvas): CanvasGraph {
  return {
    nodes: safeParse<Node[]>(row.nodes, []),
    edges: safeParse<Edge[]>(row.edges, []),
  };
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}
