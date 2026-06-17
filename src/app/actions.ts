"use server";

import { revalidatePath } from "next/cache";

import {
  createConversation,
  deleteConversation,
  renameConversation,
  setChatTools,
  setConversationModel,
} from "@/lib/conversations";
import type { ConversationType } from "@/db/schema";

/** Where each conversation surface lives, so server actions revalidate the right route. */
const SURFACE_PATH: Record<ConversationType, string> = {
  chat: "/",
  agent: "/agents",
  research: "/research",
  experimental: "/experimental",
};

export async function newConversationAction(
  type: ConversationType = "chat",
): Promise<string> {
  const conversation = createConversation(type);
  revalidatePath(SURFACE_PATH[type]);
  return conversation.id;
}

export async function deleteConversationAction(
  id: string,
  type: ConversationType = "chat",
): Promise<void> {
  deleteConversation(id);
  revalidatePath(SURFACE_PATH[type]);
}

export async function renameConversationAction(
  id: string,
  title: string,
  type: ConversationType = "chat",
): Promise<void> {
  renameConversation(id, title);
  revalidatePath(SURFACE_PATH[type]);
}

/** Persists the enabled tool keys for a Chat conversation (null/empty = lean, no tools). */
export async function setChatToolsAction(id: string, tools: string[] | null): Promise<void> {
  setChatTools(id, tools);
  revalidatePath("/");
}

export async function setConversationModelAction(
  id: string,
  model: string | null,
  type: ConversationType = "chat",
): Promise<void> {
  setConversationModel(id, model);
  revalidatePath(SURFACE_PATH[type]);
}
