"use server";

import { revalidatePath } from "next/cache";

import {
  createWorkspace,
  deleteWorkspace,
  renameWorkspace,
} from "@/lib/workspaces";
import { buildOpencodeTask, type TaskKind } from "@/lib/opencode-task";

export async function newWorkspaceAction(
  path: string,
  title?: string,
): Promise<{ id: string } | { error: string }> {
  const { workspace, error } = createWorkspace(path, title);
  if (error || !workspace) {
    return { error: error ?? "Could not create the workspace." };
  }
  revalidatePath("/opencode");
  return { id: workspace.id };
}

export async function deleteWorkspaceAction(id: string): Promise<void> {
  deleteWorkspace(id);
  revalidatePath("/opencode");
}

export async function renameWorkspaceAction(id: string, title: string): Promise<void> {
  renameWorkspace(id, title);
  revalidatePath("/opencode");
}

/** Builds a task prompt from a Loom source to hand off to opencode. */
export async function buildOpencodeTaskAction(
  sourceId: string,
  kind: TaskKind,
): Promise<{ task: string } | { error: string }> {
  const task = buildOpencodeTask(sourceId, kind);
  if (!task) return { error: "Nothing to send yet." };
  return { task };
}
