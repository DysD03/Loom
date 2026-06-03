"use server";

import { revalidatePath } from "next/cache";

import type { ConversationType, MemoryType } from "@/db/schema";
import {
  addMemory,
  deleteMemory,
  extractMemoriesFromConversation,
  setMemoryPinned,
  updateMemory,
} from "@/lib/memory";
import { createConversation, renameConversation } from "@/lib/conversations";
import { generateSuggestions, type Suggestion } from "@/lib/suggestions";

const SURFACE_PATH: Record<ConversationType, string> = {
  chat: "/",
  agent: "/agents",
  research: "/research",
};

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

/** Generates personalized session suggestions from stored memories. */
export async function generateSuggestionsAction(): Promise<
  { suggestions: Suggestion[] } | { error: string }
> {
  try {
    return { suggestions: await generateSuggestions() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to generate suggestions." };
  }
}

/**
 * Creates a new conversation on the given surface, titled after the suggestion,
 * and returns the path to open (with the prompt as a `seed` query param).
 */
export async function launchSuggestionAction(
  surface: ConversationType,
  title: string,
  prompt: string,
): Promise<string> {
  const conversation = createConversation(surface);
  if (title.trim()) {
    renameConversation(conversation.id, title.trim());
  }
  revalidatePath(SURFACE_PATH[surface]);
  return `${SURFACE_PATH[surface]}?c=${conversation.id}&seed=${encodeURIComponent(prompt)}`;
}
