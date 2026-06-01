# Loom — Build Plan

A personal, local-first web UI for a local LLM. Five tabs: **Chat**, **Agents**, **Deep Research**, **Canvas**, **Memory**. Everything runs on localhost; no cloud, no telemetry.

This document is the source of truth for scope and sequencing. It is updated at the end of every phase.

---

## Operating rules

- Work in small, verifiable phases. **Stop after each phase**, summarize, give manual test steps, and wait for confirmation before continuing.
- Boring, well-supported libraries only. No abandoned packages.
- TypeScript strict mode. Lint + format enforced. No stray diagnostics.
- At a real architectural fork, **stop and ask** rather than guess.

---

## Locked stack decisions

| Concern                             | Choice                                                                                   | Notes                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Framework                           | Next.js (App Router) + TypeScript                                                        | Single full-stack app on localhost                                                                |
| UI                                  | Tailwind CSS + shadcn/ui                                                                 | Dark mode default; dense, keyboard-friendly                                                       |
| Chat/agent streaming + tool calling | Vercel AI SDK (`ai`)                                                                     | OpenAI-compatible provider                                                                        |
| Canvas                              | React Flow (`@xyflow/react`)                                                             | + `dagre` for auto-layout                                                                         |
| DB                                  | **SQLite via Drizzle ORM** (`better-sqlite3`)                                            | Chosen over Prisma: lighter, TS-native, simple migrations via `drizzle-kit`. DB file in `./data/` |
| Migrations                          | `drizzle-kit`                                                                            | Never hand-edit the DB                                                                            |
| Vector search                       | `sqlite-vec` extension, **fallback to in-DB cosine** if the extension is painful to load | Embeddings from local LLM `/embeddings` endpoint                                                  |
| MCP                                 | `@modelcontextprotocol/sdk` (client)                                                     | stdio + SSE/HTTP transports                                                                       |
| LLM connection                      | OpenAI-compatible base URL, configurable                                                 | Default LM Studio `http://localhost:1234/v1`; Ollama via base URL swap only                       |

### Open decisions (revisit when the phase arrives)

- **Vector search**: ✅ DECIDED (Phase 2) — in-DB cosine in JS; embeddings stored as JSON `number[]`. Not `sqlite-vec`.
- **Embeddings model**: configurable in Settings; default to whatever the user sets (e.g. `nomic-embed-text` / `text-embedding-*`).

---

## Data model (sketch — refined per phase)

- `settings` — single-row key/value or typed columns: llmBaseUrl, llmModel, embeddingsModel, searxngUrl, etc.
- `conversations` — id, title, type (chat|agent|research), model override, timestamps.
- `messages` — id, conversationId, role, content, toolCalls JSON, createdAt.
- `canvases` — id, title, nodes JSON, edges JSON, timestamps.
- `mcp_servers` — id, name, transport, command/args/url, env JSON, enabled, status.
- `memories` — id, content, type, sourceConversationId, embedding (blob/json), pinned, createdAt.
- `research_reports` — id, conversationId, question, plan JSON, sources JSON, report markdown, createdAt.

---

## Phases

### Phase 0 — Scaffold ✅ (confirmed)

- Next.js + TS (strict) + Tailwind + shadcn.
- App shell: 5 tabs (Chat, Agents, Deep Research, Canvas, Memory) — empty placeholders.
- DB + Drizzle wired up; initial migration; `./data/` dir.
- Settings page: LLM base URL, model, embeddings model, SearXNG URL — persisted to DB.
- Prove a "hello" call to the local LLM works (server route → OpenAI-compatible chat completion).
- Lint + Prettier configured.
- **Checkpoint.**

Task breakdown:

1. `create-next-app` (App Router, src dir, import alias `@/*`).
2. Enable TS strict; add Prettier + ESLint config + format/lint scripts.
3. Install + init Tailwind (via create-next-app) and shadcn/ui; dark mode default.
4. Install Drizzle + better-sqlite3 + drizzle-kit; define `settings` schema; generate + run migration; ensure `./data/loom.db`.
5. Settings repository (get/set) + server actions/route handlers.
6. App shell layout: left nav with 5 tabs, routed pages with placeholders.
7. Settings page UI bound to DB (load + save).
8. `/api/llm/ping` route: read settings, call `${baseUrl}/chat/completions`, return result; a "Test connection" button in Settings.
9. README with install/run/configure (LLM + SearXNG note).

### Phase 1 — Chat ✅ (confirmed)

Streaming chat, persistence, conversation sidebar, markdown + code blocks with copy, per-conversation model override, "Send to Canvas" stub.

Built: `conversations` + `messages` tables (migration `0001`); conversations repo (`src/lib/conversations.ts`); LLM provider via `@ai-sdk/openai-compatible` (`src/lib/provider.ts`); `/api/chat` streaming route (persists user msg before stream, assistant msg in `onFinish`, derives title from first user message, friendly error stream); `/api/llm/models` for the model selector; server actions for new/delete/rename/set-model; `useChat`-based `ChatView`, `ConversationList` sidebar, `ModelSelect`, Markdown renderer with syntax-highlighted copyable code blocks. "Send to Canvas" is a stub toast (full impl Phase 7). Verified: streaming SSE shape, user-message persistence, title derivation, model guard, 400/404 handling, graceful no-LLM models endpoint.

### Phase 2 — Memory core ✅ (complete — awaiting checkpoint confirmation)

Extraction, embeddings, storage, dedupe via similarity, retrieval/injection into system prompt, Memory tab CRUD (edit/delete/pin).

**Vector search decision: in-DB cosine (JS), not `sqlite-vec`** — personal-scale store, exact brute-force is instant, avoids fragile native-extension loading on Windows. Embeddings stored as JSON `number[]`. Reversible if scale grows.

Built: `memories` table (migration `0002`); `src/lib/memory.ts` (embed via `embed`/`embedMany`, cosine, CRUD, dedupe @0.9, extraction via `generateText` + tolerant JSON parse, retrieval = pinned + top-K@floor 0.3); embeddings helper in provider; `/api/chat` injects retrieved memories into the system prompt (best-effort, try/catch); Memory tab (`/memory`) with add/edit/delete/pin, type badges, source-chat links, and an embeddings-not-configured notice; "Extract memories" button in the chat header. Graceful degradation when no embeddings model (text-exact dedupe, recent+pinned retrieval). Verified: page rendering, CRUD listing, injection path resilience. Extraction/embeddings/semantic paths require a live model (user to verify).

### Phase 3 — MCP + built-in tools + SearXNG ✅ (complete — awaiting checkpoint confirmation)

MCP client (stdio + SSE/HTTP), server management UI, shared tool registry, built-in SearXNG search tool hitting JSON API.

Built: `mcp_servers` table (migration `0003`); `src/lib/mcp.ts` (singleton client manager, `connectServer`/`disconnectServer`/`pingServer`/`getAllMcpTools`/`callMcpTool`, global Map survives hot-reload); `src/lib/tools.ts` (shared tool registry — built-in `searchWeb` via SearXNG JSON API + dynamic `dynamicTool` wrappers for every enabled MCP server's tools); `/api/mcp/servers` CRUD (GET/POST/PATCH/DELETE); `/api/mcp/test` POST to ping + get tool count; `/api/chat` wires tools + `stopWhen: stepCountIs(5)` into `streamText` (best-effort, never blocks chat); Settings page gains MCP Servers card (add stdio/SSE servers, test connection, enable/disable, delete); `ChatView` renders `tool-invocation` parts inline via collapsible `ToolCallBlock` (amber pulse while running, expandable input/output). typecheck/lint/build green.

### Phase 4 — Agents

Tool-using loop on chat surface, inline collapsible tool-call/result blocks, iteration cap, tool-calling capability check with graceful degrade + warning.

### Phase 5 — Deep Research

plan → search (SearXNG) → read/extract → synthesize cited report. Live progress. Persist reports.

### Phase 6 — Canvas

React Flow board: draggable/connectable nodes, pan/zoom, multi-select, idea + group/heading node types, manual edit + dagre auto-layout, persistence, canvas sidebar.

### Phase 7 — Send to Canvas

LLM-driven session → JSON graph seeding from Chat/Agents/Research; render + save.

### Phase 8 — Memory suggestions

Prompt/project idea generation from memory; launch-session buttons.

---

## Status log

- **2026-06-01** — Phase 0 started. Stack decisions locked (Drizzle chosen over Prisma).
- **2026-06-01** — Phase 0 complete. Scaffolded Next.js 16 (App Router) + React 19 + Tailwind v4 + shadcn (Base UI style). Drizzle + better-sqlite3 wired; `app_settings` table migrated to `./data/loom.db`. App shell with 5 tab placeholders + Settings. Settings persists via server action; `/api/llm/ping` tests the LLM connection and degrades gracefully. typecheck/lint/build all green; runtime smoke test passed.
  - Notable: create-next-app pulled **Next 16** (not 15) and shadcn now defaults to the **Base UI** ("base-nova") style instead of Radix — flag if either is a concern.
- **2026-06-01** — Phase 1 complete. Streaming chat working end to end against the `/api/chat` route with DB persistence, conversation sidebar (new/rename/delete), per-conversation model override, and markdown rendering with copyable code blocks. typecheck/lint/build green; runtime smoke test passed (incl. graceful errors with no LLM).
  - Notable: installed **AI SDK v6** (`ai@6`, `@ai-sdk/react@3`). Key API specifics now in CLAUDE.md — `convertToModelMessages` is **async**; `useChat` has no `input`/`handleSubmit` (manage input, call `sendMessage({ text })`); messages use `parts`. Base UI dropdown/select use `render` prop + `data-[popup-open]` (not `asChild`/`data-[state=open]`).
  - Also fixed a chat layout bug post-checkpoint: `ChatView` needed `flex-1 min-w-0` (was only half-width) and `min-h-0` on scroll containers so the message list scrolls internally instead of growing the page.
- **2026-06-01** — Phase 2 complete.
- **2026-06-01** — Phase 3 complete. MCP client + tool registry + SearXNG search wired end-to-end. `@modelcontextprotocol/sdk` + `zod` added. `mcp_servers` table migrated. Tool calls render inline in Chat with collapsible blocks. typecheck/lint/build green. Memory core: in-DB cosine vector search, embeddings via local `/embeddings`, on-demand extraction from chats, dedupe, system-prompt injection, and a full Memory tab (add/edit/delete/pin). typecheck/lint/build green; runtime-verified page + injection resilience (LLM-dependent paths left for user to verify).
