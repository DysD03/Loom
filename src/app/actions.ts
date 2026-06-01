"use server";

import { revalidatePath } from "next/cache";

import {
  createConversation,
  deleteConversation,
  renameConversation,
  setConversationModel,
} from "@/lib/conversations";

export async function newConversationAction(): Promise<string> {
  const conversation = createConversation("chat");
  revalidatePath("/");
  return conversation.id;
}

export async function deleteConversationAction(id: string): Promise<void> {
  deleteConversation(id);
  revalidatePath("/");
}

export async function renameConversationAction(id: string, title: string): Promise<void> {
  renameConversation(id, title);
  revalidatePath("/");
}

export async function setConversationModelAction(
  id: string,
  model: string | null,
): Promise<void> {
  setConversationModel(id, model);
  revalidatePath("/");
}
