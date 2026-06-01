import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Single-row application settings (id is always 1).
 * Holds the local LLM connection config and other globally configurable values.
 */
export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  llmBaseUrl: text("llm_base_url").notNull().default("http://localhost:1234/v1"),
  llmApiKey: text("llm_api_key").notNull().default("lm-studio"),
  llmModel: text("llm_model").notNull().default(""),
  embeddingsModel: text("embeddings_model").notNull().default(""),
  searxngUrl: text("searxng_url").notNull().default("http://localhost:8080"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export type AppSettings = typeof appSettings.$inferSelect;
export type AppSettingsInsert = typeof appSettings.$inferInsert;

/** A conversation thread. `type` distinguishes Chat / Agents / Deep Research surfaces. */
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("New chat"),
  type: text("type", { enum: ["chat", "agent", "research"] })
    .notNull()
    .default("chat"),
  /** Per-conversation model override; null means fall back to global settings. */
  model: text("model"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["system", "user", "assistant"] }).notNull(),
    content: text("content").notNull().default(""),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export type Conversation = typeof conversations.$inferSelect;
export type ConversationType = Conversation["type"];
export type Message = typeof messages.$inferSelect;
export type MessageRole = Message["role"];

/** Durable facts learned about the user, used to personalize sessions and suggest ideas. */
export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    content: text("content").notNull(),
    type: text("type", {
      enum: ["preference", "project", "goal", "context", "fact"],
    })
      .notNull()
      .default("fact"),
    /** Conversation this fact was extracted from; kept if that conversation is deleted. */
    sourceConversationId: text("source_conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" },
    ),
    /** JSON-encoded number[] embedding, or null when no embeddings model was available. */
    embedding: text("embedding"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (t) => [index("memories_pinned_idx").on(t.pinned)],
);

export type Memory = typeof memories.$inferSelect;
export type MemoryType = Memory["type"];

export const MEMORY_TYPES = [
  "preference",
  "project",
  "goal",
  "context",
  "fact",
] as const satisfies readonly MemoryType[];
