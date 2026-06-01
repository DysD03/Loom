"use server";

import { revalidatePath } from "next/cache";

import type { MemoryType } from "@/db/schema";
import {
  addMemory,
  deleteMemory,
  extractMemoriesFromConversation,
  setMemoryPinned,
  updateMemory,
} from "@/lib/memory";

export async function addMemoryAction(content: string, type: MemoryType): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) {
    return;
  }
  await addMemory(trimmed, type);
  revalidatePath("/memory");
}

export async function updateMemoryAction(
  id: string,
  content: string,
  type: MemoryType,
): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) {
    return;
  }
  await updateMemory(id, trimmed, type);
  revalidatePath("/memory");
}

export async function deleteMemoryAction(id: string): Promise<void> {
  deleteMemory(id);
  revalidatePath("/memory");
}

export async function togglePinAction(id: string, pinned: boolean): Promise<void> {
  setMemoryPinned(id, pinned);
  revalidatePath("/memory");
}

/** Extracts durable memories from a conversation. Returns how many were added/skipped. */
export async function extractMemoriesAction(
  conversationId: string,
): Promise<{ added: number; skipped: number }> {
  const { added, skipped } = await extractMemoriesFromConversation(conversationId);
  revalidatePath("/memory");
  return { added: added.length, skipped };
}
