# Loom


<img width="1464" height="781" alt="image" src="https://github.com/user-attachments/assets/69030c54-ea33-4546-98a2-4603f00d5388" />





A personal, **local-first** web UI for your own local LLM. Everything runs on your machine — no cloud services, no telemetry, no accounts.

## Introduction

**Loom** is a single, self-hosted workspace that wraps your local model (via LM Studio, Ollama, or any OpenAI-compatible server) in everything you'd actually want around it: streaming chat, a tool-using agent loop, deep research with cited reports, a visual idea canvas, a real coding agent, a personal knowledge base your model can read, and a memory that learns durable facts about you. It's built for people who want the convenience of a polished AI workspace without sending a single token to the cloud.

The philosophy is simple: **your data, your machine, your model.** The app is a Next.js full-stack project backed by a local SQLite database — point it at a model, and every feature works entirely offline. Switching from LM Studio to Ollama (or any other OpenAI-compatible backend) is a base-URL change in Settings, nothing more. It was built phase by phase (see `PLAN.md`), and each capability lives on its own tab:

Tabs (built phase by phase — see `PLAN.md`):

- **Chat** — streaming conversational chat
- **Agents** — chat that calls tools (built-in + MCP) in an agent loop
- **Deep Research** — plan → search (SearXNG) → read → **cited report**, with live staged progress and a numbered source list matching the inline `[n]` citations
- **Canvas** — a React Flow whiteboard for connected ideas: editable idea/heading nodes, free-form connections, drag/pan/zoom/multi-select, one-click **dagre auto-layout**, and debounced autosave. **Send to Canvas** (from Chat, Agents, or Deep Research) asks the model to distill the session into a concept map and seeds a new board
- **OpenCode** — drive the [opencode](https://github.com/sst/opencode) coding agent to actually build/run projects on your machine. Add a project folder as a workspace, give it a task, and watch it work; **Send to OpenCode** turns a Chat/Agent/Research/Canvas session into a build task. Loom manages a local `opencode serve` for you
- **Documents** — a local **RAG** knowledge base: drag-and-drop PDF, Markdown, and text files; Loom chunks + embeds them, then the model references the most relevant excerpts automatically in Chat and Agents (and on demand via a `searchDocuments` tool)
- **Memory** — durable facts about you, used to personalize sessions and to generate launchable suggestions

> **Status:** Phases 0–8 complete, plus an **OpenCode** tab (Phase 9) and a **Documents / RAG** tab (Phase 10) — **Chat**, **Memory**, **MCP + Tools**, **Agents**, **Deep Research**, **Canvas**, **OpenCode**, and **Documents** are all live. Sessions can be turned into a Canvas concept map via **Send to Canvas** or into a real build task via **Send to OpenCode**, uploaded files are referenced automatically via retrieval, and the Memory tab generates **personalized session suggestions** you can launch in one click.
>
> The UI wears an **8-bit retro / cyberpunk** skin: neon magenta + cyan on near-black, subtle CRT scanlines + vignette, fluid animations, a self-hosted **JetBrainsMono Nerd Font**, and a pixel display font (Press Start 2P) for the logo.
>
> - **Chat** — streaming, persisted, markdown + copyable code, per-conversation model override
> - **Agents** — a multi-step tool-using loop on its own tab: built-in + MCP tools, streamed reasoning, an in-message step tracker, a per-session settings popover (max steps + tool toggles), and a tool-capability check that degrades to plain chat with a warning when the model can't call tools
>   - **Personas** — a reusable library of named identities/system prompts (seeded with Loom, Senior Engineer, Skeptic, Researcher); assign one per session, with full create/edit/delete
>   - **Self-dialogue** — the agent can debate itself (**Solver ↔ Critic**) for a configurable number of rounds before answering; the debate streams as collapsible reasoning, then a final synthesis answers with tools. Each voice can be cast from a persona
> - **Memory** — durable facts with embeddings-based dedupe/retrieval, injected into every session; add/edit/delete/pin; on-demand extraction from chats
> - **Tools** — built-in `searchWeb` (SearXNG), `readUrl` (fetch a page → readable text), `calculator`, and `currentDateTime`, wired into Chat and Agents; MCP servers (stdio + SSE/HTTP) managed from Settings, tools auto-loaded into the assistant. Tool calls and reasoning are persisted, so they replay when you reopen a conversation.
>
> For Memory's semantic features, set an **embeddings model** in Settings (e.g. `nomic-embed-text` / `text-embedding-*` exposed by LM Studio/Ollama). Without one, memories still work but use exact-text dedupe and recent/pinned retrieval.
>
> Tool calling (Agents, search + MCP) requires a model that supports function/tool calling (e.g. Qwen2.5, Llama 3.1+). If the model doesn't support tools the chat still works — tool calls simply won't be attempted, and the Agents tab shows a clear warning.

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

Click **Test** to connect and see how many tools the server exposes. Enabled servers are connected automatically on the next chat request and their tools are injected alongside the built-in tools. In the **Agents** tab you can toggle individual tools (built-in or MCP) on/off per session via the **Agent** settings popover.

## OpenCode (run coding tasks locally)

The **OpenCode** tab uses [opencode](https://github.com/sst/opencode) to build and run projects on your machine. Install it and configure a model provider first:

```bash
curl -fsSL https://opencode.ai/install | bash   # then ensure it's on your PATH
opencode auth login                              # configure a model provider
```

> opencode uses **its own** provider config (separate from Loom's LM Studio settings). It can point at the same local model — set that up in opencode.

Then in Loom: open **OpenCode → New workspace**, enter a project folder path (e.g. `~/dev/my-app`). Loom starts and manages a local `opencode serve` for you and addresses each workspace by folder — you never launch it manually. Give the agent a task and watch it edit files and run commands **in that folder**. From **Chat**, **Agents**, **Deep Research**, or **Canvas**, hit **Send to OpenCode** to turn that session into a build task.

> ⚠️ The OpenCode tab executes code and shell commands on your machine in the folders you add. It's scoped to workspaces you explicitly choose, but it has a bigger blast radius than the rest of Loom — point it at projects you trust.

## Documents (RAG)

The **Documents** tab is a local retrieval-augmented-generation knowledge base. Drag files onto the uploader (or browse) and Loom extracts their text, splits it into overlapping chunks, and embeds each chunk for semantic search — all on your machine.

- **Supported files** — PDF (parsed in-process via [`unpdf`](https://github.com/unjs/unpdf), no native dependencies), Markdown, and text formats (`.txt`, `.csv`, `.json`, `.yaml`, `.log`, …), up to 25 MB each.
- **Automatic grounding** — for every Chat and Agent message, the most relevant excerpts are retrieved and injected into the system prompt, so answers are grounded in your own files and cite the source document by name.
- **On-demand tool** — agents also get a built-in **`searchDocuments`** tool to query the knowledge base explicitly (toggleable per session like any other tool).

> Documents need an **embeddings model** set in Settings (e.g. `nomic-embed-text` / `text-embedding-*`) to be searchable. Without one, files are still uploaded and chunked but won't be retrieved — the tab shows a notice when no embeddings model is configured.

## Project layout

```
src/
  app/            # routes: / (Chat), /agents, /research, /canvas, /documents, /memory, /settings
    api/
      chat/       # streaming chat route (tools + memory + document injection)
      agent/      # agent route: multi-step tool loop, capability-gated tools
      documents/  # multipart upload → parse → chunk → embed → store
      tools/      # available-tool list (for the per-session toggles)
      llm/        # ping + models endpoints
      mcp/        # servers CRUD + test connection
  components/     # nav, chat view, tool-call + reasoning blocks, agent settings, documents, shadcn/ui
  db/             # Drizzle schema + better-sqlite3 client
  lib/            # settings, provider, memory, documents (RAG), mcp client, tool registry, agent, capabilities
data/loom.db      # SQLite database (gitignored)
drizzle/          # committed migrations
```

Stack: Next.js (App Router) · TypeScript (strict) · Tailwind + shadcn/ui · Drizzle ORM + better-sqlite3. See `CLAUDE.md` for conventions and `PLAN.md` for the phased roadmap.
