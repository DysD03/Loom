# Loom

A personal, **local-first** web UI for your own local LLM. Everything runs on your machine — no cloud services, no telemetry, no accounts.

Five tabs (built phase by phase — see `PLAN.md`):

- **Chat** — streaming conversational chat
- **Agents** — chat that calls tools (built-in + MCP) in an agent loop
- **Deep Research** — plan → search (SearXNG) → read → cited report
- **Canvas** — a React Flow whiteboard for connected ideas
- **Memory** — durable facts about you, used to personalize and suggest

> **Status:** Phase 3 complete — **Chat**, **Memory**, and **MCP + Tools** are live. Agents / Deep Research / Canvas are placeholders until their phases land.
>
> - **Chat** — streaming, persisted, markdown + copyable code, per-conversation model override
> - **Memory** — durable facts with embeddings-based dedupe/retrieval, injected into every session; add/edit/delete/pin; on-demand extraction from chats
> - **Tools** — built-in `searchWeb` tool (SearXNG JSON API) wired into every chat; MCP servers (stdio + SSE/HTTP) managed from Settings, tools auto-loaded into the assistant
>
> For Memory's semantic features, set an **embeddings model** in Settings (e.g. `nomic-embed-text` / `text-embedding-*` exposed by LM Studio/Ollama). Without one, memories still work but use exact-text dedupe and recent/pinned retrieval.
>
> Tool calling (search + MCP) requires a model that supports function/tool calling (e.g. Qwen2.5, Llama 3.1+). If the model doesn't support tools the chat still works — tool calls simply won't be attempted.

---

## Requirements

- **Node.js** ≥ 20.19 (developed on Node 24)
- A local **OpenAI-compatible LLM server** — [LM Studio](https://lmstudio.ai/) (default) or [Ollama](https://ollama.com/)
- (Later phases) **Docker** for a local SearXNG instance

## Install & run

```bash
npm install
npm run db:migrate   # create ./data/loom.db from migrations
npm run dev          # http://localhost:3000
```

## Configure your LLM

1. Start your local server and **load a model**:
   - **LM Studio** → Developer tab → Start Server (defaults to `http://localhost:1234/v1`).
   - **Ollama** → runs at `http://localhost:11434/v1`; pull a model with `ollama pull <model>`.
2. Open **Settings** in Loom and set:
   - **Base URL** — `http://localhost:1234/v1` (LM Studio) or `http://localhost:11434/v1` (Ollama).
   - **Model** — the identifier your server exposes.
   - **Embeddings model** — used by Memory (later phase).
   - **API key** — any dummy value; local servers ignore it.
3. Click **Test connection** — you should see a success toast with the model name.

Switching backends is a **base-URL change only** — no code changes.

> **Tool calling:** Agents, MCP, and Deep Research need a model that supports function/tool calling (e.g. Qwen2.5, Llama 3.1+). Those tabs will warn and fall back to plain chat if the configured model can't call tools.

## SearXNG (web search, used from Phase 3)

The search tool and Deep Research call a local [SearXNG](https://github.com/searxng/searxng) instance's JSON API directly. Run one with Docker, and **enable the JSON format** in its settings (SearXNG ships with JSON disabled by default) — add `json` under `search.formats` in `searxng/settings.yml`, then point Loom's **SearXNG URL** setting at it (default `http://localhost:8080`):

```bash
docker run -d --name searxng -p 8080:8080 \
  -v "$PWD/searxng:/etc/searxng" \
  docker.io/searxng/searxng:latest
```

On Windows PowerShell, replace `"$PWD/searxng"` with `"${PWD}\searxng"`.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (http://localhost:3000) |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run format` | Prettier write |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `./data/loom.db` |
| `npm run db:studio` | Inspect the DB in Drizzle Studio |

## MCP servers

Add any [Model Context Protocol](https://modelcontextprotocol.io/) server from **Settings → MCP Servers**. Both transports are supported:

- **stdio** — specify a command (e.g. `npx`) and args JSON array (e.g. `["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]`); optional env vars as a JSON object.
- **SSE/HTTP** — specify the SSE endpoint URL (e.g. `http://localhost:3001/sse`).

Click **Test** to connect and see how many tools the server exposes. Enabled servers are connected automatically on the next chat request and their tools are injected alongside the built-in `searchWeb` tool.

## Project layout

```
src/
  app/            # routes: / (Chat), /agents, /research, /canvas, /memory, /settings
    api/
      chat/       # streaming chat route (tools + memory injection)
      llm/        # ping + models endpoints
      mcp/        # servers CRUD + test connection
  components/     # nav, chat view, tool-call blocks, shadcn/ui
  db/             # Drizzle schema + better-sqlite3 client
  lib/            # settings, provider, memory, mcp client, tool registry
data/loom.db      # SQLite database (gitignored)
drizzle/          # committed migrations
```

Stack: Next.js (App Router) · TypeScript (strict) · Tailwind + shadcn/ui · Drizzle ORM + better-sqlite3. See `CLAUDE.md` for conventions and `PLAN.md` for the phased roadmap.
