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

/** Solver↔Critic self-dialogue settings for an agent session. */
export interface SelfDialogueConfig {
  enabled: boolean;
  /** Number of Solver/Critic round trips before synthesizing the answer. */
  rounds: number;
  /** Persona cast as the Solver voice; null means a built-in Solver role. */
  solverPersonaId: string | null;
  /** Persona cast as the Critic voice; null means a built-in Critic role. */
  criticPersonaId: string | null;
}

/** Per-session agent configuration. `null` fields mean "use defaults / all tools". */
export interface AgentConfig {
  maxSteps: number | null;
  /** Enabled tool registry keys; null means all tools are enabled. */
  tools: string[] | null;
  /** Assigned persona id; null means the built-in default identity. */
  personaId: string | null;
  selfDialogue: SelfDialogueConfig;
}

export const DEFAULT_SELF_DIALOGUE: SelfDialogueConfig = {
  enabled: false,
  rounds: 2,
  solverPersonaId: null,
  criticPersonaId: null,
};

function parseSelfDialogue(raw: string | null): SelfDialogueConfig {
  if (!raw) {
    return { ...DEFAULT_SELF_DIALOGUE };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SelfDialogueConfig>;
    return {
      enabled: Boolean(parsed.enabled),
      rounds:
        typeof parsed.rounds === "number" && parsed.rounds > 0
          ? Math.floor(parsed.rounds)
          : DEFAULT_SELF_DIALOGUE.rounds,
      solverPersonaId:
        typeof parsed.solverPersonaId === "string" ? parsed.solverPersonaId : null,
      criticPersonaId:
        typeof parsed.criticPersonaId === "string" ? parsed.criticPersonaId : null,
    };
  } catch {
    return { ...DEFAULT_SELF_DIALOGUE };
  }
}

export function getAgentConfig(id: string): AgentConfig {
  const convo = getConversation(id);
  let tools: string[] | null = null;
  if (convo?.agentTools) {
    try {
      const parsed = JSON.parse(convo.agentTools) as unknown;
      if (Array.isArray(parsed)) {
        tools = parsed.filter((t): t is string => typeof t === "string");
      }
    } catch {
      // Corrupt JSON falls back to "all tools".
    }
  }
  return {
    maxSteps: convo?.agentMaxSteps ?? null,
    tools,
    personaId: convo?.agentPersonaId ?? null,
    selfDialogue: parseSelfDialogue(convo?.agentReasoning ?? null),
  };
}

export function setAgentConfig(id: string, config: AgentConfig): Conversation | undefined {
  return db
    .update(conversations)
    .set({
      agentMaxSteps: config.maxSteps && config.maxSteps > 0 ? Math.floor(config.maxSteps) : null,
      agentTools: config.tools ? JSON.stringify(config.tools) : null,
      agentPersonaId: config.personaId ?? null,
      agentReasoning: config.selfDialogue.enabled
        ? JSON.stringify(config.selfDialogue)
        : null,
      updatedAt: new Date().toISOString(),
    })
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
  /** Full UIMessage parts (tool calls, reasoning, text); stored as JSON for replay. */
  parts?: UIMessage["parts"];
}): Message {
  const { parts, ...rest } = input;
  const row = db
    .insert(messages)
    .values({
      id: randomUUID(),
      ...rest,
      parts: parts && parts.length ? JSON.stringify(parts) : null,
    })
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
  return rows.map((row) => {
    if (row.parts) {
      try {
        const parts = JSON.parse(row.parts) as UIMessage["parts"];
        if (Array.isArray(parts) && parts.length) {
          return { id: row.id, role: row.role, parts };
        }
      } catch {
        // Corrupt parts JSON falls back to plain text below.
      }
    }
    return {
      id: row.id,
      role: row.role,
      parts: [{ type: "text", text: row.content }],
    };
  });
}
