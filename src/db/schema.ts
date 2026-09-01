import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Single-row application settings (id is always 1).
 * Holds the local LLM connection config and other globally configurable values.
 */
export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  llmBaseUrl: text("llm_base_url").notNull().default("http://localhost:1234/v1"),
  llmApiKey: text("llm_api_key").notNull().default("lm-studio"),
  llmModel: text("llm_model").notNull().default(""),
  /**
   * Second local OpenAI-compatible endpoint, addressed by an `ollama/` model
   * prefix. Empty means not configured, so the app behaves exactly as it did
   * with a single local server until a URL is filled in.
   */
  ollamaBaseUrl: text("ollama_base_url").notNull().default(""),
  ollamaApiKey: text("ollama_api_key").notNull().default("ollama"),
  /** Small model for background tasks (titles, memory extraction, canvas seeding, suggestions). Empty = use llmModel. */
  utilityModel: text("utility_model").notNull().default(""),
  embeddingsModel: text("embeddings_model").notNull().default(""),
  /** Cloud provider API keys. Empty string means that provider is not configured. */
  anthropicApiKey: text("anthropic_api_key").notNull().default(""),
  openaiApiKey: text("openai_api_key").notNull().default(""),
  googleApiKey: text("google_api_key").notNull().default(""),
  searxngUrl: text("searxng_url").notNull().default("http://localhost:8080"),
  /**
   * Self-reported cost of running this machine, in $ per hour (electricity /
   * amortization). Powers the benchmark cost estimates; 0 means not configured.
   */
  computeCostPerHour: real("compute_cost_per_hour").notNull().default(0),
  /**
   * JSON-encoded TokenPrice[] — per-model $/1M input and output token rates for
   * metered (cloud) providers. Machine $/hour is the wrong basis for those, and
   * prices change too often to hardcode, so the user supplies them.
   */
  tokenPricing: text("token_pricing").notNull().default("[]"),
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

/**
 * A Markdown → dashboard. Stores the source Markdown and the generated
 * DashboardSpec (see `src/lib/dashboard-spec.ts`) as JSON. The spec comes from
 * the LLM when it is reachable, or from the deterministic Markdown parser
 * otherwise (`generatedBy` records which, so the UI can offer a re-run).
 */
export const dashboards = sqliteTable("dashboards", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("Untitled dashboard"),
  /** The Markdown the dashboard is built from. */
  sourceMarkdown: text("source_markdown").notNull().default(""),
  /** Where the Markdown came from: a file name, an Editor doc title, or "Pasted Markdown". */
  sourceName: text("source_name").notNull().default(""),
  /** JSON-encoded DashboardSpec; null until first generated. */
  spec: text("spec"),
  generatedBy: text("generated_by", { enum: ["model", "fallback"] })
    .notNull()
    .default("fallback"),
  /** Model id that produced the spec (when generatedBy is "model"). */
  model: text("model"),
  /** Latest generation problem (e.g. the LLM was unreachable), if any. */
  error: text("error"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export type DashboardRow = typeof dashboards.$inferSelect;

/**
 * A benchmark suite — a named set of tasks (see BenchTask in
 * `src/lib/benchmark-score.ts`) stored as JSON. `builtin` rows are the seeded
 * standardized suites; the rest are user-authored custom benchmarks.
 */
export const benchmarkSuites = sqliteTable("benchmark_suites", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  builtin: integer("builtin", { mode: "boolean" }).notNull().default(false),
  /** JSON-encoded BenchTask[]. */
  tasks: text("tasks").notNull().default("[]"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export type BenchmarkSuite = typeof benchmarkSuites.$inferSelect;

/**
 * One benchmark execution: a suite snapshot run against a set of models. The
 * tasks are copied in at creation so runs stay reproducible when the suite is
 * later edited or deleted. Per-task outputs land in `benchmark_results`.
 */
export const benchmarkRuns = sqliteTable("benchmark_runs", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("Benchmark run"),
  suiteId: text("suite_id").references(() => benchmarkSuites.id, { onDelete: "set null" }),
  suiteName: text("suite_name").notNull().default(""),
  /** JSON-encoded string[] of the compared model ids. */
  models: text("models").notNull().default("[]"),
  /** JSON-encoded BenchTask[] snapshot taken at run creation. */
  tasks: text("tasks").notNull().default("[]"),
  status: text("status", {
    enum: ["pending", "running", "done", "error", "cancelled"],
  })
    .notNull()
    .default("pending"),
  /** Populated when status is "error". */
  error: text("error"),
  /** Wall-clock bounds of the execution, for cost estimates. */
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  /** Snapshot of `app_settings.computeCostPerHour` at creation; null = no rate set. */
  costPerHour: real("cost_per_hour"),
  /**
   * Sampling temperature used for every request in this run. Defaults to 0 so a
   * re-run of the same suite against the same model is reproducible; raise it
   * deliberately to measure sampling variance.
   */
  temperature: real("temperature").notNull().default(0),
  /**
   * JSON map of model → { latencyMs, ttftMs } for the discarded warmup request.
   * Kept out of the scored results so weight-loading time never contaminates the
   * timing averages, but surfaced because cold start is itself worth knowing.
   */
  coldStarts: text("cold_starts").notNull().default("{}"),
  /**
   * How many times each task is run per model. More samples narrow the
   * confidence interval on accuracy; 1 means a single sample and no interval
   * worth quoting.
   */
  repeats: integer("repeats").notNull().default(1),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export type BenchmarkRun = typeof benchmarkRuns.$inferSelect;
export type BenchmarkRunStatus = BenchmarkRun["status"];

/** One model's answer to one task of a run, with its score and timing. */
export const benchmarkResults = sqliteTable(
  "benchmark_results",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => benchmarkRuns.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    taskIndex: integer("task_index").notNull(),
    /** Which sample of this cell this row is, 0-based. */
    repeatIndex: integer("repeat_index").notNull().default(0),
    output: text("output").notNull().default(""),
    /** 0..1 (binary for deterministic scorers, graded for the judge). */
    score: real("score").notNull().default(0),
    passed: integer("passed", { mode: "boolean" }).notNull().default(false),
    latencyMs: integer("latency_ms").notNull().default(0),
    /** Time to first streamed token (reasoning or text); null for legacy rows. */
    ttftMs: integer("ttft_ms"),
    /**
     * Request-encode window: `streamText` call → HTTP request dispatched — client-side
     * message conversion and JSON serialization. Null for legacy rows.
     */
    encodeMs: integer("encode_ms"),
    /** Dispatch → response headers: transport plus the server accepting the request. */
    queueMs: integer("queue_ms"),
    /** Response headers → first output token: the prompt-evaluation (prefill) window. */
    prefillMs: integer("prefill_ms"),
    /** First output token → end of the request: the decode (generation) window. */
    decodeMs: integer("decode_ms"),
    /** Median gap between streamed chunks — steady-state per-token latency. */
    interTokenP50Ms: real("inter_token_p50_ms"),
    /** 95th-percentile gap between streamed chunks — generation stutter. */
    interTokenP95Ms: real("inter_token_p95_ms"),
    /** Streamed text chunks observed (the inter-token sample size). */
    streamChunks: integer("stream_chunks"),
    outputTokens: integer("output_tokens"),
    promptTokens: integer("prompt_tokens"),
    /** Generation speed: output tokens ÷ (total − TTFT). Legacy rows used total time. */
    tokensPerSecond: real("tokens_per_second"),
    /**
     * Prefill throughput: first-turn prompt tokens ÷ the prefill window. Legacy rows
     * divided by the whole TTFT (the column name predates the phase split).
     */
    prefillTokensPerSecond: real("prompt_tokens_per_second"),
    /** Request/scoring failure for this cell, if any. */
    error: text("error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (t) => [index("benchmark_results_run_idx").on(t.runId, t.model, t.taskIndex)],
);

export type BenchmarkResult = typeof benchmarkResults.$inferSelect;

/**
 * The connected Gmail account (single row, id 1). Holds the user-supplied
 * OAuth client (from their own Google Cloud project), the tokens minted by the
 * consent flow, and the connected address. Everything stays in the local
 * SQLite DB — tokens are only ever sent to Google's own endpoints.
 */
export const gmailAccount = sqliteTable("gmail_account", {
  id: integer("id").primaryKey().default(1),
  clientId: text("client_id").notNull().default(""),
  clientSecret: text("client_secret").notNull().default(""),
  /** Address of the connected account; empty until the consent flow completes. */
  email: text("email").notNull().default(""),
  refreshToken: text("refresh_token").notNull().default(""),
  accessToken: text("access_token").notNull().default(""),
  /** Unix ms when `accessToken` expires (auto-refreshed before use). */
  accessTokenExpiresAt: integer("access_token_expires_at").notNull().default(0),
  /** Scopes actually granted at consent time. */
  scope: text("scope").notNull().default(""),
  /** CSRF state for an in-flight OAuth round-trip ("uuid.timestampMs"). */
  oauthState: text("oauth_state"),
  connectedAt: text("connected_at"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export type GmailAccount = typeof gmailAccount.$inferSelect;

/**
 * Cached LLM summaries of Gmail threads, keyed by thread + its newest message
 * so a new reply naturally invalidates the cache.
 */
export const emailSummaries = sqliteTable(
  "email_summaries",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    /** Newest message id in the thread at summarize time. */
    lastMessageId: text("last_message_id").notNull().default(""),
    summary: text("summary").notNull().default(""),
    model: text("model").notNull().default(""),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (t) => [index("email_summaries_thread_idx").on(t.threadId, t.lastMessageId)],
);

export type EmailSummary = typeof emailSummaries.$inferSelect;

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
