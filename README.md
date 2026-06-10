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
- **Editor** — a Markdown document editor with live preview and built-in AI: inline **assist** (rewrite / expand / shorten / fix grammar) on a selection, a **doc-aware side chat** that always sees the current text, and a one-click **Verify use cases** review that surfaces gaps, contradictions, edge cases, and unstated assumptions. Documents you write are auto-saved and **indexed into the RAG knowledge base**, so Chat and Agents can reference them
- **Documents** — a local **RAG** knowledge base: drag-and-drop PDF, Markdown, and text files; Loom chunks + embeds them, then the model references the most relevant excerpts automatically in Chat and Agents (and on demand via a `searchDocuments` tool)
- **Memory** — durable facts about you, used to personalize sessions and to generate launchable suggestions

> The UI wears an **8-bit retro / cyberpunk** skin: neon magenta + cyan on near-black, subtle CRT scanlines + vignette, fluid animations, a self-hosted **JetBrainsMono Nerd Font**, and a pixel display font (Press Start 2P) for the logo.
>
> - **Chat** — streaming, persisted, markdown + copyable code, per-conversation model override, and a live **context-window usage meter** (estimated tokens used vs. the loaded model's context length)
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

## Run with Docker

Loom ships a multi-stage `Dockerfile` and a `docker-compose.yml`. Migrations are
applied automatically on container start, and the SQLite DB + uploaded documents
are persisted to the host via the `./data` volume.

```bash
docker compose up -d --build   # build + run, http://localhost:3000
```

Or with plain Docker:

```bash
docker build -t loom .
docker run -d --name loom -p 3000:3000 \
  -v "$PWD/data:/app/data" \
  --add-host host.docker.internal:host-gateway \
  loom
```

**Point Loom at your LLM:** the model server (LM Studio / Ollama) runs on the
**host**, not in the container, so `localhost` won't reach it from inside. In
**Settings → Base URL**, use `host.docker.internal` instead:

- LM Studio → `http://host.docker.internal:1234/v1`
- Ollama → `http://host.docker.internal:11434/v1`

(On Docker Desktop for Windows/Mac that host resolves automatically; the compose
file and the `--add-host` flag above make it work on Linux too.)

> Same caveats as the LAN setup: there's **no authentication** — keep the
> published port on a trusted network. To declare MCP servers via a file,
> uncomment the `mcp.json` mount in `docker-compose.yml`.

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

## Access from another device on your home network

Loom is just a web app, so any laptop/phone on the same Wi-Fi can use it once the
server listens on the LAN and the firewall lets the port through. The LLM, SearXNG,
and OpenCode all keep running on the **host** machine — only the browser moves.

1. **Find the host's LAN IP** (the machine running Loom). In PowerShell:

   ```powershell
   (Get-NetIPAddress -AddressFamily IPv4 |
     Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' }).IPAddress
   ```

   Say it's `192.168.1.50`.

2. **Allow the port through Windows Firewall** (run PowerShell as Administrator, once):

   ```powershell
   New-NetFirewallRule -DisplayName "Loom 3000" -Direction Inbound `
     -Action Allow -Protocol TCP -LocalPort 3000 -Profile Private
   ```

   `-Profile Private` keeps it to networks you've marked as "private" (home), not public ones.

3. **Start Loom bound to the LAN.** For a stable home server, use the production build:

   ```bash
   npm run build
   npm run start:lan        # listens on 0.0.0.0:3000
   ```

   For development with hot-reload over the LAN, just use `dev:lan` — the host's
   own LAN IPs are auto-added to `allowedDevOrigins` so cross-origin navigation
   and Server Actions work:

   ```bash
   npm run dev:lan
   ```

   (Add more origins, e.g. a hostname, via `LOOM_DEV_ORIGINS=host1,host2` if needed.)

4. **On the other laptop**, open `http://192.168.1.50:3000`.

Notes:

- There's **no authentication** — anyone on your network can use it. Keep it to a
  trusted home LAN; don't forward the port to the internet.
- Settings like the **LLM Base URL** stay `http://localhost:...` — they're resolved
  on the host, not the visiting browser, so leave them as-is.
- A different port: pass `-p`, e.g. `npm run start:lan -- -p 4000`, and open that
  port in the firewall rule.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (http://localhost:3000) |
| `npm run dev:lan` / `npm run start:lan` | Same, but listening on the whole LAN (`-H 0.0.0.0`) |
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

### Declaring servers in a file

Instead of the UI, you can drop an `mcp.json` file at the project root. It uses the same `mcpServers` shape as Claude Desktop, so you can paste a server's published config straight in. Copy `mcp.example.json` to get started:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\me\\notes"]
    },
    "remote-sse": { "url": "http://localhost:3001/sse" },
    "turned-off": { "command": "npx", "args": ["-y", "pkg"], "disabled": true }
  }
}
```

- A server with a `url` is treated as **SSE/HTTP**; otherwise it's **stdio** and needs a `command`. `env` is an optional object of strings. Set `"disabled": true` to keep an entry without connecting it.
- File-declared servers appear in **Settings → MCP Servers** with a **file** badge. Edit the file to change them; you can **Test** them, and **Delete** removes the entry from `mcp.json` (so it stays gone). UI-added servers are left untouched.
- The file is re-read on each Settings load and whenever tools are resolved — no restart needed. Parse errors are shown in the MCP Servers card.
- `mcp.json` is **gitignored** by default because it can hold tokens (the `env` block). Remove the `/mcp.json` line from `.gitignore` if yours has no secrets and you want to commit it.

## OpenCode (run coding tasks locally)

The **OpenCode** tab uses [opencode](https://github.com/sst/opencode) to build and run projects on your machine. Install it and configure a model provider first:

```bash
curl -fsSL https://opencode.ai/install | bash   # then ensure it's on your PATH
opencode auth login                              # configure a model provider
```

> opencode uses **its own** provider config (separate from Loom's LM Studio settings). It can point at the same local model — set that up in opencode.

Then in Loom: open **OpenCode → New workspace**, enter a project folder path (e.g. `~/dev/my-app`). Loom starts and manages a local `opencode serve` for you and addresses each workspace by folder — you never launch it manually. Give the agent a task and watch it edit files and run commands **in that folder**. From **Chat**, **Agents**, **Deep Research**, or **Canvas**, hit **Send to OpenCode** to turn that session into a build task.

> ⚠️ The OpenCode tab executes code and shell commands on your machine in the folders you add. It's scoped to workspaces you explicitly choose, but it has a bigger blast radius than the rest of Loom — point it at projects you trust.

## Editor

The **Editor** tab is a distraction-light Markdown editor with a live preview, backed by the same local model.

- **Inline assist** — select some text (or act on the whole document) and apply **Rewrite**, **Expand**, **Shorten**, or **Fix grammar**; the model's result replaces your selection in place.
- **Doc-aware assistant** — a side-panel chat that always has the current document as context. Ask questions about the draft, or click **Verify use cases** for a structured review of gaps, contradictions, missing/edge cases, ambiguous requirements, and unstated assumptions.
- **Auto-save + RAG indexing** — edits autosave as you write, and the document is mirrored into the Documents knowledge base so Chat and Agents can reference it (needs an embeddings model, same as uploads). Editor-authored docs are managed here, not in the Documents upload list.

## Documents (RAG)

The **Documents** tab is a local retrieval-augmented-generation knowledge base. Drag files onto the uploader (or browse) and Loom extracts their text, splits it into overlapping chunks, and embeds each chunk for semantic search — all on your machine.

- **Supported files** — PDF (parsed in-process via [`unpdf`](https://github.com/unjs/unpdf), no native dependencies), Markdown, and text formats (`.txt`, `.csv`, `.json`, `.yaml`, `.log`, …), up to 25 MB each.
- **Automatic grounding** — for every Chat and Agent message, the most relevant excerpts are retrieved and injected into the system prompt, so answers are grounded in your own files and cite the source document by name.
- **On-demand tool** — agents also get a built-in **`searchDocuments`** tool to query the knowledge base explicitly (toggleable per session like any other tool).

> Documents need an **embeddings model** set in Settings (e.g. `nomic-embed-text` / `text-embedding-*`) to be searchable. Without one, files are still uploaded and chunked but won't be retrieved — the tab shows a notice when no embeddings model is configured.

## Project layout

```
src/
  app/            # routes: / (Chat), /agents, /research, /canvas, /opencode, /editor, /documents, /memory, /settings
    api/
      chat/       # streaming chat route (tools + memory + document injection)
      agent/      # agent route: multi-step tool loop, capability-gated tools
      editor/     # doc-aware assistant chat for the Editor tab
      documents/  # multipart upload → parse → chunk → embed → store
      tools/      # available-tool list (for the per-session toggles)
      llm/        # ping + models endpoints
      mcp/        # servers CRUD + test connection
  components/     # nav, chat view, tool-call + reasoning blocks, agent settings, editor, documents, shadcn/ui
  db/             # Drizzle schema + better-sqlite3 client
  lib/            # settings, provider, memory, documents (RAG), editor, chat-store, mcp client, tool registry, agent, capabilities
data/loom.db      # SQLite database (gitignored)
drizzle/          # committed migrations
```

Stack: Next.js (App Router) · TypeScript (strict) · Tailwind + shadcn/ui · Drizzle ORM + better-sqlite3. See `CLAUDE.md` for conventions and `PLAN.md` for the phased roadmap.
