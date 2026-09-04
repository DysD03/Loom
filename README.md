# Loom


<img width="1464" height="781" alt="image" src="https://github.com/user-attachments/assets/69030c54-ea33-4546-98a2-4603f00d5388" />





A personal, **local-first** web UI for your own local LLM. Everything runs on your machine — no cloud services, no telemetry, no accounts.

## 📊 New: Dashboards & Benchmarks

Two new tabs join the workspace:

- **Dashboards** — turn any **Markdown into a live dashboard**: paste text, upload a `.md` file, or pick an Editor document, and the model extracts its numbers, tables, and lists into a structured spec rendered with Loom's own theme-native widgets — KPI stat tiles, bar/line/area/donut charts (hover tooltips + a table-view twin per chart), tables, checklists, callouts, and meters. When the model is unreachable a deterministic Markdown parser builds the dashboard instead (with a clear notice), so it always renders; edit the source or add guidance and **Regenerate** anytime.
- **Benchmarks** — race up to 5 models (local + cloud, mixed) through **standardized or custom benchmark suites** and compare them with live charts: a leaderboard with **95% confidence intervals** (and a *tied* badge when a gap isn't statistically real), overall + per-category accuracy, a per-request **encode → queue → prefill → decode** breakdown, latency distributions (median/p95/spread), **decode + prefill tokens/sec, TPOT and inter-token jitter**, radar profiles, an accuracy-vs-speed scatter, a task × model heatmap, and self-reported **cost estimates** ($/run and $/1M tokens from your machine's $/hr rate). An **Analysis** section says what the scores are made of — a **failure taxonomy** (wrong answer / format miss / refusal / cut off / empty / timeout / error), a **head-to-head diff** of exactly which tasks one model wins and the other loses, and a **raw CSV/JSON export** of every sample. Plus repeats to average out sampling noise, **temperature sweeps**, a **parallel-load probe**, a pinnable **baseline** that shows later runs as deltas, **resume** for a cancelled run, a sortable/filterable per-task matrix with every model's raw output, a **History** view trending any metric across runs, and a one-click **PDF export**. Seven built-in auto-scored suites (92 tasks) ship out of the box — deliberately hard, so models actually separate — covering reasoning, knowledge, instruction following, long-context retrieval, **multi-turn long workflows**, and timing-only **Speed & Latency** probes; custom suites support exact/contains/numeric/regex/multiple-choice/JSON scoring, an LLM-as-judge mode, timing-only tasks, and **multi-turn prompts**.

## 🧪 New: Experimental Agent (bidirectional goal-convergence)

A new **Experimental Agent** tab runs a *meet-in-the-middle* search between a **start** state and a **goal** state. Three roles work together: a **Forward agent** builds outward from the start, a **Backward agent** regresses from the goal, and a **Reconciler** detects where the two frontiers meet and stitches the full **START → … → GOAL** path (Dijkstra-flavored: it expands the cheapest frontier node first and prefers the lowest-cost meeting).

What it does:

- **Web-grounded reasoning (no hallucinating)** — every expansion is backed by a **live SearXNG search + a Firecrawl (MCP) scrape** of the top result, fed in as the only evidence the agents may use, so steps are built on real sources instead of the model's memory. Two header **tool windows** (SearXNG / Firecrawl) spin while active and show their last query/URL on hover.
- **Decoupled frontiers** — each agent stays in its lane and takes the most direct, lowest-cost step; all convergence logic lives in the reconciler, which emits one focused hint per side each round. A small **round window** shows progress.
- **Live, resumable runs** — the search streams round-by-round; if you reload mid-run it keeps going server-side and the view polls back to catch up. A **Cancel** button truly aborts the run (and its in-flight model call).
- **Transparent + explained** — a **research log** records every SearXNG search and Firecrawl scrape with timestamps (what was looked up, and when), and when a path is found it writes a short **summary of how it gets from start to goal**.
- **Always lands somewhere** — on success it **auto-builds a Canvas** of the whole search with the taken path highlighted in neon-green; when no bridge is found it recommends concrete **alternative options to pursue**. **Send to Editor** exports the final answer (summary + path) as a Markdown doc (RAG-indexed).

> Grounding uses your existing **SearXNG** instance plus a **Firecrawl MCP server** (add it under MCP servers / `mcp.json`). It needs a tool-capable, reasonably strong model — each round makes several model calls plus a search + scrape, so runs are deliberate, not instant.

## ⚡ Performance

A dedicated performance pass keeps Loom feeling instant, even with a large knowledge base and several MCP servers:

- **Faster time-to-first-token** — each chat/agent message embeds the query **once** (shared by memory + document retrieval), runs both retrievals **in parallel**, and builds the tool registry (and the agent's tool-capability probe) concurrently — instead of five sequential round trips before streaming starts.
- **Cached vector corpus** — document-chunk and memory embeddings are parsed once into `Float32Array`s and cached per document/memory, instead of re-`JSON.parse`-ing the entire knowledge base on every message.
- **Cheap MCP resolution** — `mcp.json` is only re-synced when the file actually changes (mtime check), servers connect in parallel, and an unreachable server backs off for 30s instead of adding a spawn-and-fail delay to every message.
- **Leaner client bundle** — the code syntax highlighter lazy-loads as a separate chunk (`PrismAsync`), keeping multiple MB of Prism grammars out of the main chat bundle.
- **Smoother streaming** — message bubbles are memoized so each streamed token re-renders only the live message (not the whole conversation), and the context meter estimates tokens incrementally instead of rescanning every message per token.
- **Faster writes** — SQLite runs in WAL mode with `synchronous=NORMAL`, so persisting a message never pays a per-commit disk fsync.

## Introduction

**Loom** is a single, self-hosted workspace that wraps your local model (via LM Studio, Ollama, or any OpenAI-compatible server) in everything you'd actually want around it: streaming chat, a tool-using agent loop, deep research with cited reports, a visual idea canvas, a real coding agent, a personal knowledge base your model can read, and a memory that learns durable facts about you. It's built for people who want the convenience of a polished AI workspace without sending a single token to the cloud.

The philosophy is simple: **your data, your machine, your model.** The app is a Next.js full-stack project backed by a local SQLite database — point it at a model, and every feature works entirely offline. Switching from LM Studio to Ollama (or any other OpenAI-compatible backend) is a base-URL change in Settings, nothing more — and you can run **both at once**, addressing the second server's models with an `ollama/` prefix. It was built phase by phase (see `PLAN.md`), and each capability lives on its own tab:

Tabs (built phase by phase — see `PLAN.md`):

- **Chat** — streaming conversational chat
- **Email** — connect your **Gmail** (via your own Google OAuth client — tokens never leave the local DB): triage the inbox, read threads safely, get **AI thread summaries** and an **unread digest**, reply with an **AI-drafted composer**, and hand goals to an **email assistant** that plans multi-email tasks and executes them with tools — every send pauses for your explicit approval
- **Agents** — chat that calls tools (built-in + MCP) in an agent loop
- **Deep Research** — plan → search (SearXNG) → read → **cited report**, with live staged progress and a numbered source list matching the inline `[n]` citations
- **Experimental Agent** — bidirectional goal-convergence search (Forward + Backward agents + Reconciler) that meets in the middle to stitch a START → GOAL path, **grounded in live SearXNG + Firecrawl** evidence; auto-builds a Canvas of the taken path, or recommends alternatives when no path is found (see above)
- **Canvas** — a React Flow whiteboard for connected ideas: editable idea/heading nodes, free-form connections, drag/pan/zoom/multi-select, one-click **dagre auto-layout**, and debounced autosave. **Talk to canvas** — a board-aware chat that answers questions about the graph *and* edits it live (add / connect / rename / remove nodes). **Send to Canvas** (from Chat, Agents, or Deep Research) asks the model to distill the session into a concept map and seeds a new board
- **Dashboards** — turn any **Markdown into a live dashboard**: paste text, upload a `.md` file, or pick an Editor document, and the model extracts its numbers, tables, and lists into a structured spec rendered with native widgets — KPI stat tiles, bar/line/area/donut charts (hover tooltips + a table-view twin per chart), tables, checklists, callouts, and meters. When the model is unreachable a deterministic Markdown parser builds the dashboard instead (with a clear notice), so it always renders; edit the source or add guidance and **Regenerate** anytime
- **Benchmarks** — race up to 5 models (local + cloud, mixed) through **standardized or custom benchmark suites** and compare them with live charts: a leaderboard with confidence intervals, accuracy, a per-request encode/queue/prefill/decode breakdown, latency distributions, decode + prefill throughput, TPOT and inter-token jitter, radar profiles, an accuracy-vs-speed scatter, a per-task heatmap, a failure taxonomy and head-to-head diff, self-reported cost estimates, raw CSV/JSON export, temperature sweeps, a parallel-load probe, baseline pinning, resume, and a cross-run History view. Seven built-in auto-scored suites, deliberately hard so models actually separate (incl. long-context retrieval, multi-turn long workflows, and timing-only Speed & Latency); custom suites support deterministic scoring, an LLM-as-judge mode, timing-only tasks, and multi-turn prompts
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

**Updating an existing install:** `git pull && npm install && npm run dev`. Any
migrations that arrived with the pull are applied when the app starts, so a new
column never leaves you staring at a `no such column` error — `npm run
db:migrate` is still there if you'd rather apply them yourself first.

## Run with Docker

Loom ships a multi-stage `Dockerfile` and a `docker-compose.yml`. Migrations are
applied automatically on container start, and the SQLite DB + uploaded documents
are persisted in the `loom-data` volume.

```bash
docker compose up -d --build   # build + run, http://localhost:3000
```

Or with plain Docker:

```bash
docker build -t loom .
docker run -d --name loom -p 3000:3000 \
  -v loom-data:/app/data \
  --add-host host.docker.internal:host-gateway \
  loom
```

**Why a named volume and not `./data`?** SQLite runs in WAL mode, which needs
shared-memory mmap on the database file. Host bind mounts on Docker Desktop
(Windows/macOS) don't support it, so `-v "$PWD/data:/app/data"` fails with
`disk I/O error` on the first write. A named volume lives in the Linux VM's own
filesystem, where WAL works. To move an existing DB in or out:

```bash
docker compose stop loom
docker cp ./data/loom.db loom:/app/data/loom.db   # host → container
docker cp loom:/app/data/loom.db ./data/loom.db   # container → host
docker compose start loom
```

(Copy only `loom.db` — leave the `-wal`/`-shm` sidecar files behind; stopping the
container first checkpoints them into the main file.)

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

### Running two local servers at once

You don't have to choose. **Settings → Second local server** takes a second
OpenAI-compatible base URL (Ollama's `http://localhost:11434/v1` by default), and
both servers stay connected at the same time:

- The primary server owns plain model ids (`qwen2.5-7b-instruct`); the second
  server's models are prefixed **`ollama/`** (`ollama/llama3.2:3b`). Existing
  model ids keep working untouched — nothing is re-pointed.
- Both servers' models appear together in every model picker, so you can chat on
  one and run background tasks on the other (set a `ollama/…` **utility model**),
  or **benchmark them head to head** in a single run.
- Each card has its own **Test connection** button. The second one doesn't need a
  model selected first — it asks the server which models it has.
- Leave the second base URL empty to turn it off. A server that is down never
  blocks the other: the model list degrades to whichever endpoint answered.

Both endpoints are queried in parallel, and the chat context meter reads context
length from whichever server owns the model (LM Studio's `/api/v0/models`,
Ollama's `/api/show`).

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
| `npm run db:migrate` | Apply migrations to `./data/loom.db` (also done on app start) |
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

## Benchmarks (compare your models)

The **Benchmarks** tab races local and cloud models through the same task set and charts the results — accuracy, per-category strengths, and a full performance breakdown: every request is split into **encode → queue → prefill → decode**, with throughput, percentiles, and inter-token jitter on top.

Each task can be asked several times, so accuracy is reported as a **95% confidence interval** rather than a bare percentage, and a gap that is not statistically real is badged *tied*. Pin one run as the **baseline** and later runs of the same suite show what they gained or lost against it:

![Benchmark run view: leaderboard with confidence intervals and baseline deltas across five local models](docs/screenshots/benchmarks-run.png)

Every request is split into four measured phases that add up to the response
time, so it is obvious whether a model is slow to *start* or slow to *finish*:

![Request phase breakdown: encode, queue, prefill and decode per model](docs/screenshots/benchmarks-phases.png)

Each model also gets a profile scaled against the run's best, so the gap to the
outer ring is exactly what that model gives up:

![Per-model performance profile radars](docs/screenshots/benchmarks-radar.png)

A leaderboard says a model lost; **Analysis** says what it lost on. The
head-to-head splits two models' tasks four ways and shows the losing reply
inline, so "both 80%" stops hiding the fact that they fail on different things:

![Head-to-head diff between two models, with each losing reply shown inline](docs/screenshots/benchmarks-analysis.png)

Failures are bucketed by *kind*, which separates a model that is wrong from one
that is right in a shape the scorer won't take — the second is a prompt fix, not
a model swap:

![Failure taxonomy table: wrong answers, format misses and refusals per model](docs/screenshots/benchmarks-failures.png)

The task loop is strictly serial, so per-task timings stay uncontended — which
means it can never tell you how the server behaves under real load. An optional
probe runs afterwards, on its own prompt, to answer exactly that:

![Parallel-load probe: aggregate throughput at 1, 2 and 4 requests in flight](docs/screenshots/benchmarks-load.png)

Results accumulate across runs, and any metric can be trended over time with a
last-run-against-the-one-before view for catching regressions:

![Benchmark history: time-to-first-token trend and run-over-run comparison](docs/screenshots/benchmarks-history.png)

Any run can be exported as a PDF, with the sections you choose:

![Export PDF tab with section toggles and a live report preview](docs/screenshots/benchmarks-export.png)

- **Pick any mix of models** — everything your local endpoints expose (both LM Studio *and* Ollama, if you run [two local servers](#running-two-local-servers-at-once)), curated cloud models for each provider with an API key, or any free-text model id (up to 5 per run). Requests run one at a time so latency and tokens/sec stay uncontended and honest, and every model gets a discarded **warmup request** first so weight-loading never lands in the first timed task (its cold start is reported separately).
- **Standardized suites** — seven built-in, deterministically auto-scored suites (92 tasks), tuned to *separate* models rather than to be passed:
  - **Quick Check** (10) — a fast spread over arithmetic, reasoning traps, format control, and extraction with distractors. Short answers, so it still finishes quickly on a slow model.
  - **Reasoning & Math** (18) — multi-step word problems, probability, base conversion, geometry, constraint puzzles, and traps where one slip changes the answer.
  - **General Knowledge** (18) — multiple choice with plausible distractors and planted misconceptions (the universal *plasma* donor is not the universal red-cell donor; a tritone is not a fifth).
  - **Instruction Following** (14) — exact word counts, a forbidden letter, precise separators, deeply nested JSON, an acrostic, a substitution list, and a twelve-word sentence with no letter `s`. Tests control of the output; a model that adds a preamble scores zero.
  - **Long Context & Retrieval** (12) — questions over 3,700–5,000-token logs: buried facts, near-identical distractors (`RT-1180` vs `RT-1108`), a two-hop join, a value superseded by a later correction, selective counting, and `NOT FOUND` when the fact genuinely isn't there.
  - **Long Workflows** (10) — **multi-turn procedures of 4–7 turns each**: a running ledger with a cancelled transaction, inventory edits, a format rule that must hold for the whole conversation, a rule that is later retracted, conflicting profile updates, a fact join across turns, and a calculation chain where every step feeds the next. Only the final answer is scored and it needs every earlier turn, so drifting once ends the task. The closest thing here to real agent work.
  - **Speed & Latency** (10) — timing-only probes that isolate one phase at a time: near-empty prompts for the latency floor, 500/1.5K/3K-token prompts for prefill throughput, and long answers for decode speed and stutter.

  A benchmark everything passes measures nothing, so these are deliberately hard — expect capable local models to land well short of 100%, and weak ones near the floor. Scoring never depends on a model's opinion, so results stay comparable across runs.

  > **Runtime:** Quick Check is seconds per model; Long Workflows issues ~56 requests per model (every turn is a request) and Long Context sends 3,700–5,000-token prompts, so both take meaningfully longer. Run those two when you want depth, not on every iteration.
- **Phase-level metrics** — every request is instrumented at the HTTP boundary, so each result records **encode** (building and serializing the request), **queue** (on the wire until the server answers), **prefill** (prompt evaluation up to the first token), and **decode** (generation) — four phases that add up exactly to the response time. From those come TTFT, decode tok/s (post-TTFT time only), **prefill tok/s**, **TPOT** (time per output token), and **inter-token latency** p50/p95 for stutter.
- **Repeats and confidence intervals** — set **samples per task** (1–10) and every task is asked that many times. Accuracy is then reported as a Wilson 95% interval rather than a bare percentage, ranks whose intervals overlap the leader's are badged **tied**, and the task matrix shows the honest split (`3/5`, not a checkmark). A single sample cannot tell 70% from 75%; five can.
- **Analysis — head-to-head** — pick any two models and see the tasks split four ways: A ahead, B ahead, both clean, level-and-neither-clean. Compared on *pass rate*, so with repeats a 5/5 against a 3/5 still counts. Each row shows the losing model's actual reply.
- **Analysis — failure taxonomy** — every failed sample is bucketed: **wrong answer**, **format miss**, **refused**, **cut off**, **empty reply**, **timed out**, **request failed**. A format miss means the right answer was in the reply but not in a shape the scorer accepts (a number buried in prose, an MCQ letter the extractor passed over, JSON written as text, an answer wrapped in a preamble) — claimed only on unambiguous evidence, because it excuses the model. A pile of them is a prompt problem; a pile of wrong answers is a model problem. An **unstable tasks** count shows how many tasks the model neither always passed nor always failed.
- **Raw export** — `GET /api/benchmark/<run>/export?format=csv|json` (and two buttons in the UI) return one row per model × task × repeat with the full output, the four phase timings, token counts and the failure kind. RFC 4180 quoted, so outputs containing commas and newlines survive the trip to a spreadsheet.
- **Temperature sweep** — enter two or more temperatures and each model runs once per step, appearing on the leaderboard as its own variant (`llama3.2:3b @ t0.8`). Every view — charts, head-to-head, heatmap, PDF — treats the variants as models, so the cost of sampling on *your* suite is visible in one run.
- **Parallel-load probe** — optional, and run after the task loop on its own prompt so contended requests can never land inside a timed task. Reports aggregate throughput at 1, 2 and 4 requests in flight: if it stays flat, the server is queueing rather than serving in parallel.
- **Baselines and resume** — pin any finished run as the **baseline** and later runs of the same suite show accuracy and latency deltas per model. A cancelled or failed run can be **resumed**: only the cells that never finished are re-run, the original start time is kept so the cost estimate still spans the whole thing, and a cold start already measured is not measured again.
- **Comparison charts** — a stacked phase breakdown, box-and-whisker spreads for response time / TTFT / decode speed (median, quartiles, p95, min–max), a median→p95 inter-token dumbbell, per-model **radar profiles** scaled to the run's best, an accuracy-against-speed scatter for the quality/latency trade-off, and a task × model **heatmap** you can switch between seven metrics. Every chart has an **All metrics** table twin — no number is hover-only.
- **Custom suites** — author your own tasks with exact / contains / numeric / regex / multiple-choice / JSON scoring, an **AI judge** mode that grades 0–10 against your reference answer (uses the utility model), or **timing-only** tasks with no correctness check. Tasks can be **multi-turn**: add follow-up turns and the final reply is scored.
- **Live results** — runs execute in the background and the page streams progress; charts and the leaderboard update as results land, and a run can be cancelled mid-flight. Each run snapshots its tasks, so editing a suite later never rewrites history.
- **Drill down** — the task matrix is sortable and filterable (category, passed/failed, per-model score); click a row to see the prompt, the expected answer, and every model's raw output with timing.
- **History** — a cross-run view trends any of eleven metrics (accuracy, decode/prefill throughput, TTFT, prefill and decode time, TPOT, mean and p95 response time, spread, cost) over time, plus a **last run against the one before** view for spotting regressions, above a sortable table of every past result. Runs that compared different model sets still trend whatever they share.
- **Export PDF** — turn any run into a printable report: pick the run, toggle which sections it carries (leaderboard, latency breakdown, distributions, throughput, all-metrics table, per-task results, cost), preview the exact document, and save it. The report renders on a light paper surface with its own validated palette, paginates properly, and is produced entirely by your browser's print dialog — nothing is uploaded anywhere.
- **Cost estimates** — set your machine's **$ per hour** in Settings (watts × $/kWh is a good starting point) and each run shows an estimated compute cost plus an estimated **$ per 1K/1M tokens** from the measured speed, with a what-if calculator to compare against hosted-API pricing. Self-reported and clearly labelled — local inference is never metered.

## Dashboards (Markdown → dashboard)

The **Dashboards** tab turns a Markdown document into a dashboard rendered with Loom's own widgets — no charting library, just theme-native SVG.

- **Three sources** — paste Markdown, upload a `.md`/`.txt` file, or load an Editor document straight into the form.
- **Structured, not freeform** — the model emits a JSON spec (stat tiles, bar/line/area/donut charts, tables, checklists, progress meters, callouts, quotes, short text blocks), and Loom renders it. Numbers must come from the document; the spec is validated and tolerantly repaired before it's saved.
- **Readable charts** — a colorblind-validated palette derived from the app's neon hues, hover tooltips on every mark, and a one-click **table view** twin per chart.
- **Always renders** — if the model is down or returns junk, a deterministic parser builds the dashboard from the Markdown structure itself (headings → sections, numeric tables → charts, `Label: value` lists → KPI rows) and the header says so; hit **Regenerate** once your LLM is back.
- **Iterate** — open **Source** to edit the Markdown or add guidance ("focus on the revenue numbers") and regenerate; a failed regenerate keeps the previous dashboard.

## Documents (RAG)

The **Documents** tab is a local retrieval-augmented-generation knowledge base. Drag files onto the uploader (or browse) and Loom extracts their text, splits it into overlapping chunks, and embeds each chunk for semantic search — all on your machine.

- **Supported files** — PDF (parsed in-process via [`unpdf`](https://github.com/unjs/unpdf), no native dependencies), Markdown, and text formats (`.txt`, `.csv`, `.json`, `.yaml`, `.log`, …), up to 25 MB each.
- **Automatic grounding** — for every Chat and Agent message, the most relevant excerpts are retrieved and injected into the system prompt, so answers are grounded in your own files and cite the source document by name.
- **On-demand tool** — agents also get a built-in **`searchDocuments`** tool to query the knowledge base explicitly (toggleable per session like any other tool).

> Documents need an **embeddings model** set in Settings (e.g. `nomic-embed-text` / `text-embedding-*`) to be searchable. Without one, files are still uploaded and chunked but won't be retrieved — the tab shows a notice when no embeddings model is configured.

## Email (Gmail)

The **Email** tab connects Loom to your Gmail so the local model can help you triage, summarize, and answer real mail. Loom talks to the Gmail API directly with an OAuth client **you** create — tokens live in the local SQLite DB, and mail content is only ever sent to whatever model you configured.

- **Inbox** — Inbox / Unread / Sent / All views, full Gmail search syntax (`from:`, `is:unread`, `newer_than:7d`, …), pagination, and unread markers. Opening a thread marks it read; archive and mark-unread are one click.
- **Safe reading** — messages render as plain text by default; HTML mail opens in a fully sandboxed frame (no scripts) with remote images **blocked until you allow them** (bye, tracking pixels). Attachments download through Loom.
- **Summaries** — one click summarizes a thread (cached until new mail arrives, re-runnable), and the ✨ digest button streams a briefing of your unread mail grouped into *needs a reply / worth reading / low priority*.
- **Replies** — a composer with reply / reply-all and an **AI draft** button (plus an optional guidance field) that streams a ready-to-edit reply. Sends are proper Gmail replies — same thread, correct `In-Reply-To`/`References` headers.
- **Assistant** — a docked email agent with tools (`searchEmails`, `readThread`, `sendReply`, `archiveThread`, `markThreadRead`). Give it a goal — *"find everything that needs a reply this week, make a plan, and draft the answers"* — and it states a numbered plan, executes it, and proposes replies. **Every send pauses for your approval**: you see the exact text and approve or deny it. Archive/read changes run freely; nothing is ever deleted.

### Gmail setup (one-time, ~5 minutes)

Loom ships no shared Google credentials — you use your own free OAuth client:

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Gmail API**.
2. Configure the **OAuth consent screen** (External) and add your own address as a test user. Note: apps left in *Testing* status get refresh tokens that expire after 7 days — publish the app to **Production** (the "unverified app" warning is fine to click through; you're its only user) for a permanent connection.
3. Create **Credentials → OAuth client ID → Web application**, and register the exact redirect URI the Email tab shows you (e.g. `http://localhost:3000/api/gmail/oauth/callback`).
4. Paste the client id + secret into the Email tab, **Save**, then **Connect Google account**.

Scope requested: `gmail.modify` — read, send, archive, and mark read/unread; it cannot permanently delete mail. **Disconnect** in the tab header wipes the stored tokens.

## Project layout

```
src/
  app/            # routes: / (Chat), /email, /agents, /research, /experimental, /canvas, /opencode, /editor, /documents, /memory, /settings
    api/
      chat/       # streaming chat route (tools + memory + document injection)
      agent/      # agent route: multi-step tool loop, capability-gated tools
      gmail/      # Email tab: OAuth start/callback, threads/thread/send/modify/attachment, summarize/draft/assistant
      bidirectional/  # Experimental Agent: NDJSON run stream + poll/cancel (SearXNG + Firecrawl grounding)
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
