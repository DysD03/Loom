"use server";

import { revalidatePath } from "next/cache";

import {
  createConversation,
  deleteConversation,
  renameConversation,
  setConversationModel,
} from "@/lib/conversations";
import type { ConversationType } from "@/db/schema";

/** Where each conversation surface lives, so server actions revalidate the right route. */
const SURFACE_PATH: Record<ConversationType, string> = {
  chat: "/",
  agent: "/agents",
  research: "/research",
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

export async function setConversationModelAction(
  id: string,
  model: string | null,
  type: ConversationType = "chat",
): Promise<void> {
  setConversationModel(id, model);
  revalidatePath(SURFACE_PATH[type]);
}
