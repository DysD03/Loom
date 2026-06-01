import "server-only";

import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { UIMessage } from "ai";

import { db } from "@/db/client";
import {
  conversations,
  messages,
  type Conversation,
  type ConversationType,
  type Message,
  type MessageRole,
} from "@/db/schema";

const TITLE_MAX = 60;

export function listConversations(type: ConversationType = "chat"): Conversation[] {
  return db
    .select()
    .from(conversations)
    .where(eq(conversations.type, type))
    .orderBy(desc(conversations.updatedAt))
    .all();
}

export function getConversation(id: string): Conversation | undefined {
  return db.select().from(conversations).where(eq(conversations.id, id)).get();
}

export function createConversation(type: ConversationType = "chat"): Conversation {
  const id = randomUUID();
  return db.insert(conversations).values({ id, type }).returning().get();
}

export function deleteConversation(id: string): void {
  db.delete(conversations).where(eq(conversations.id, id)).run();
}

export function renameConversation(id: string, title: string): Conversation | undefined {
  const trimmed = title.trim().slice(0, TITLE_MAX) || "Untitled";
  return db
    .update(conversations)
    .set({ title: trimmed, updatedAt: new Date().toISOString() })
    .where(eq(conversations.id, id))
    .returning()
    .get();
}

export function setConversationModel(
  id: string,
  model: string | null,
): Conversation | undefined {
  return db
    .update(conversations)
    .set({ model: model && model.trim() ? model.trim() : null })
    .where(eq(conversations.id, id))
    .returning()
    .get();
}

function touchConversation(id: string): void {
  db.update(conversations)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(conversations.id, id))
    .run();
}

/** Sets the conversation title from its first user message, only if still the default. */
function maybeSetTitleFromContent(id: string, content: string): void {
  const convo = getConversation(id);
  if (!convo || convo.title !== "New chat") {
    return;
  }
  const title = content.trim().replace(/\s+/g, " ").slice(0, TITLE_MAX);
  if (title) {
    db.update(conversations)
      .set({ title })
      .where(eq(conversations.id, id))
      .run();
  }
}

export function getMessages(conversationId: string): Message[] {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt, messages.id)
    .all();
}

export function addMessage(input: {
  conversationId: string;
  role: MessageRole;
  content: string;
}): Message {
  const row = db
    .insert(messages)
    .values({ id: randomUUID(), ...input })
    .returning()
    .get();
  touchConversation(input.conversationId);
  if (input.role === "user") {
    maybeSetTitleFromContent(input.conversationId, input.content);
  }
  return row;
}

/** Converts stored messages into the UIMessage shape the client `useChat` expects. */
export function toUIMessages(rows: Message[]): UIMessage[] {
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    parts: [{ type: "text", text: row.content }],
  }));
}
