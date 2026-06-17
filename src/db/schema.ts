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
  /** Small model for background tasks (titles, memory extraction, canvas seeding, suggestions). Empty = use llmModel. */
  utilityModel: text("utility_model").notNull().default(""),
  embeddingsModel: text("embeddings_model").notNull().default(""),
  /** Cloud provider API keys. Empty string means that provider is not configured. */
  anthropicApiKey: text("anthropic_api_key").notNull().default(""),
  openaiApiKey: text("openai_api_key").notNull().default(""),
  googleApiKey: text("google_api_key").notNull().default(""),
  searxngUrl: text("searxng_url").notNull().default("http://localhost:8080"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export type AppSettings = typeof appSettings.$inferSelect;
export type AppSettingsInsert = typeof appSettings.$inferInsert;

/** A conversation thread. `type` distinguishes Chat / Agents / Deep Research / Experimental surfaces. */
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("New chat"),
  type: text("type", { enum: ["chat", "agent", "research", "experimental"] })
    .notNull()
    .default("chat"),
  /** Per-conversation model override; null means fall back to global settings. */
  model: text("model"),
  /** Agent surface: max tool-loop steps; null means use the default cap. */
  agentMaxSteps: integer("agent_max_steps"),
  /** Agent surface: JSON-encoded string[] of enabled tool keys; null means all tools. */
  agentTools: text("agent_tools"),
  /** Agent surface: assigned persona; null means the built-in default identity. */
  agentPersonaId: text("agent_persona_id").references(() => personas.id, {
    onDelete: "set null",
  }),
  /** Agent surface: JSON-encoded SelfDialogueConfig (Solver/Critic debate); null means off. */
  agentReasoning: text("agent_reasoning"),
  /** Research surface: max search→read→reflect rounds; null means the default. */
  researchMaxRounds: integer("research_max_rounds"),
  /** Research surface: JSON-encoded string[] of enabled tool/source keys; null means defaults. */
  researchTools: text("research_tools"),
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
    /** JSON-encoded UIMessage parts (tool calls, reasoning, text); null for legacy rows. */
    parts: text("parts"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/**
 * A reusable agent persona — a named identity / system prompt. Personas can be
 * assigned to an agent session and cast as the Solver/Critic voices in a
 * self-dialogue. `builtin` rows are seeded defaults.
 */
export const personas = sqliteTable("personas", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  systemPrompt: text("system_prompt").notNull().default(""),
  builtin: integer("builtin", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export type Persona = typeof personas.$inferSelect;
export type PersonaInsert = typeof personas.$inferInsert;

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

/**
 * A Deep Research run: the question, the search plan, the gathered sources, and
 * the synthesized cited report. Belongs to a `research`-type conversation; a
 * conversation may accumulate several runs (the newest is shown).
 */
export const researchReports = sqliteTable(
  "research_reports",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    /** JSON-encoded string[] of the search queries / sub-questions. */
    plan: text("plan"),
    /** JSON-encoded ResearchSource[] (title, url, snippet, used). */
    sources: text("sources"),
    /** Final report markdown. */
    report: text("report").notNull().default(""),
    status: text("status", {
      enum: ["planning", "searching", "reading", "reflecting", "writing", "done", "error"],
    })
      .notNull()
      .default("planning"),
    /** Populated when status is "error". */
    error: text("error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (t) => [index("research_reports_conversation_idx").on(t.conversationId, t.createdAt)],
);

export type ResearchReport = typeof researchReports.$inferSelect;
export type ResearchStatus = ResearchReport["status"];

/**
 * A Bidirectional Goal-Convergence run (the Experimental Agent surface). A
 * forward agent builds from the start state, a backward agent regresses from the
 * goal, and a reconciler detects when the two frontiers meet. The evolving
 * frontiers, the reconciler's latest verdict, and the stitched bridge (once
 * found) are persisted as JSON so a run can be reloaded. Belongs to an
 * `experimental`-type conversation; the newest run is shown.
 */
export const goalRuns = sqliteTable(
  "goal_runs",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** Domain framing + shared glossary fed to every agent. */
    problemSpec: text("problem_spec").notNull().default(""),
    startState: text("start_state").notNull().default(""),
    goalState: text("goal_state").notNull().default(""),
    /** JSON-encoded GoalNode[] — the forward frontier (root F0). */
    forwardNodes: text("forward_nodes"),
    /** JSON-encoded GoalNode[] — the backward frontier (root GOAL). */
    backwardNodes: text("backward_nodes"),
    /** JSON-encoded ReconcileResult — the reconciler's latest verdict + hints. */
    reconcile: text("reconcile"),
    /** JSON-encoded BridgeResult — the stitched START→…→GOAL path, once found. */
    bridge: text("bridge"),
    /** JSON-encoded string[] of alternative options to pursue when no bridge was found. */
    recommendations: text("recommendations"),
    /** Natural-language summary of how the path goes from START to GOAL (once bridged). */
    summary: text("summary"),
    /** JSON-encoded ToolLogEntry[] — what SearXNG/Firecrawl researched, and when. */
    toolLog: text("tool_log"),
    /** Cap on search→reconcile rounds for this run. */
    maxRounds: integer("max_rounds").notNull().default(6),
    status: text("status", {
      enum: ["planning", "expanding", "reconciling", "done", "stalled", "error"],
    })
      .notNull()
      .default("planning"),
    /** Populated when status is "error". */
    error: text("error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (t) => [index("goal_runs_conversation_idx").on(t.conversationId, t.createdAt)],
);

export type GoalRun = typeof goalRuns.$inferSelect;
export type GoalStatus = GoalRun["status"];

/**
 * A Canvas board — a React Flow graph of idea/heading nodes and their edges,
 * stored as JSON. Independent of conversations.
 */
export const canvases = sqliteTable("canvases", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("Untitled canvas"),
  /** JSON-encoded React Flow Node[]. */
  nodes: text("nodes").notNull().default("[]"),
  /** JSON-encoded React Flow Edge[]. */
  edges: text("edges").notNull().default("[]"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export type Canvas = typeof canvases.$inferSelect;

/**
 * An OpenCode workspace — a local project folder that the managed `opencode`
 * server operates in (passed as the per-request `directory`). Loom tracks the
 * folder + a friendly title; opencode owns the sessions/history inside it.
 */
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("Workspace"),
  /** Absolute path to the project folder on the local machine. */
  path: text("path").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export type Workspace = typeof workspaces.$inferSelect;

/**
 * An uploaded knowledge-base document for RAG. The raw text is split into
 * `document_chunks`, each embedded for semantic retrieval. `status` tracks the
 * ingestion lifecycle so the UI can show progress / failures.
 */
export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  /** Original uploaded file name. */
  filename: text("filename").notNull().default(""),
  /** Detected file kind used for parsing (e.g. "pdf", "text", "markdown"). */
  kind: text("kind").notNull().default("text"),
  /** Where the document came from: an uploaded file, or authored in the Editor tab. */
  source: text("source", { enum: ["upload", "editor"] })
    .notNull()
    .default("upload"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  charCount: integer("char_count").notNull().default(0),
  chunkCount: integer("chunk_count").notNull().default(0),
  status: text("status", { enum: ["processing", "ready", "error"] })
    .notNull()
    .default("processing"),
  /** Populated when status is "error". */
  error: text("error"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export type Document = typeof documents.$inferSelect;
export type DocumentStatus = Document["status"];

/** A single embedded slice of a document's text, used for cosine retrieval. */
export const documentChunks = sqliteTable(
  "document_chunks",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** 0-based position of this chunk within the document. */
    chunkIndex: integer("chunk_index").notNull().default(0),
    content: text("content").notNull(),
    /** JSON-encoded number[] embedding, or null when no embeddings model was available. */
    embedding: text("embedding"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (t) => [index("document_chunks_document_idx").on(t.documentId, t.chunkIndex)],
);

export type DocumentChunk = typeof documentChunks.$inferSelect;

/**
 * A Markdown document authored in the Editor tab. Independent of conversations.
 * When saved it is mirrored into a `documents` row (source "editor") + chunks so
 * the LLM can reference it in Chat/Agents; `documentId` links to that mirror.
 */
export const editorDocuments = sqliteTable("editor_documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("Untitled document"),
  content: text("content").notNull().default(""),
  /** The mirrored RAG `documents` row, or null until first indexed. */
  documentId: text("document_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export type EditorDocument = typeof editorDocuments.$inferSelect;

/** An MCP server entry managed from the Settings page. */
export const mcpServers = sqliteTable("mcp_servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  transport: text("transport", { enum: ["stdio", "sse"] }).notNull(),
  /** stdio: executable path */
  command: text("command"),
  /** stdio: JSON-encoded string[] of arguments */
  args: text("args"),
  /** SSE/HTTP: endpoint URL */
  url: text("url"),
  /** JSON-encoded Record<string,string> extra env vars for stdio servers */
  env: text("env"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export type McpServer = typeof mcpServers.$inferSelect;
export type McpTransport = McpServer["transport"];
