# Loom — Future Plan

Improvement backlog, captured 2026-06-11. Work through these later, one at a time; same operating rules as `PLAN.md` (small verifiable phases, stop at checkpoints).

---

## A. Foundations (do first — biggest felt improvement)

### A1. Persistent MCP connections + connect-time budget — ✅ done 2026-06-13

**Problem (observed in dev logs):** every Chat/Agent message spawns all enabled MCP servers from scratch; the Docker-over-SSH server burns ~20s timing out (`WinError 10060`) before streaming starts. `lib/mcp.ts` is meant to be a singleton, but `buildToolRegistry()` reconnects per request.

- [x] Keep server connections alive between messages (reuse the singleton's clients). Was already mostly in place; added in-flight connect dedupe and self-eviction of dead connections via `client.onclose`.
- [x] Cache per-server health/tool lists for a few minutes; skip servers that recently failed. Error backoff raised 30s → 3min (`ERROR_RETRY_MS`); tool lists live on the cached connection.
- [x] Hard connect budget (~2s) when building the tool registry — `getAllMcpTools` races each connect against `CONNECT_BUDGET_MS`; a slow server is dropped from the request while its connect finishes in the background, so it costs one degraded message, not a stall per message.

### A2. Utility model setting (small model for background tasks) — ✅ done 2026-06-13

**Problem:** memory extraction took ~28s because it uses the main chat model. Titles, memory extraction, canvas seeding, and suggestions are small structured tasks.

- [x] New Settings field: utility model id (falls back to the chat model when unset). `utility_model` column + "Utility model" field under Settings → Local LLM; accepts cloud-prefixed ids too.
- [x] Route `extractMemoriesFromConversation`, `seedCanvasFromSource`/`seedCanvasFromPrompt`, `generateSuggestions` through it (`getUtilityModel()` in `lib/provider.ts`; `seedCanvasFromSource` falls back utility → conversation model → global). No title generation exists yet — wire it in when one is added. Canvas node expand/branch/critique intentionally stay on the chat model (interactive, quality-sensitive).

### A3. Per-conversation tool toggle in Chat — ✅ done 2026-06-13

**Problem:** plain Chat sends all (~68) tool definitions with every message — a big prompt-processing tax on local models, and it degrades answer quality.

- [x] Chat defaults to lean (**no tools**); opt-in per conversation. Stored in the shared `agent_tools` column (`getChatTools`/`setChatTools`; for chat, null = none). The lean path skips `buildToolRegistry` entirely — no MCP connects at all before streaming.
- [x] Reuse the Agents tool-picker UI: new `ChatTools` popover (`src/components/chat/tools.tsx`) in the chat header, persisted on close. Verified at the wire: lean sends `tools=0`, opt-in sends exactly the picked keys.

### A4. Finish the "streamed reply doesn't populate" bug — ✅ investigated + hardened 2026-06-13

Parked investigation (2026-06-11): server streams complete fine (200s in dev log), so it's client-side. Prior fix (chat memo keyed by `[conversationId, api]`, delayed sidebar refresh — see auto-memory `chat-streaming-refresh`) is intact, so this is a different path. Next step was: create a throwaway conversation, POST `/api/chat` directly, and inspect the raw SSE chunk sequence — especially the retrieval-part path (`sendStart: !retrieval` in `src/app/api/chat/route.ts`), which only activates when memories/documents match.

**Findings (2026-06-13, fake-LLM repro against the real route + real `Chat` class):**

- The retrieval-path SSE suspect is **exonerated**. With retrieval the stream indeed has no `start` chunk (first chunk is `data-retrieval`), but the AI SDK client lazily creates the assistant message on the first part regardless — replaying baseline, retrieval, and post-retrieval-history streams through `@ai-sdk/react`'s `Chat` populated messages correctly in all three cases.
- **Likely root cause found**: `chat-store.ts`'s registry was a plain module-level Map. Dev-mode Fast Refresh re-evaluates the module whenever a file in its import chain is edited, resetting the registry mid-stream — a remounting ChatView then binds a fresh empty instance while the reply streams into the orphaned one. Matches every symptom: dev-only, intermittent, server 200s, reply appears after next send. **Fixed** by pinning the registry on `globalThis` (same pattern as `lib/mcp.ts`).
- Bonus latent bug fixed: `getMessages` ordered by `created_at` (second precision) with random-UUID tie-break, so same-second message pairs could swap order on reload; now tie-broken by `rowid`.
- If it ever recurs in prod builds (no HMR there), the remaining suspect is a full page navigation mid-stream: the client fetch aborts, the server still finishes + persists (hence 200s), and nothing re-fetches — would need resumable streams to fix.

---

## B. High-value features

### B1. Message-level controls: edit / regenerate / fork

- Edit a user message and resend from that point.
- Regenerate the last assistant reply (`useChat` exposes `regenerate`).
- Fork a conversation from any message into a new one.

### B2. Chat with an open canvas

Describe-to-create exists (`CanvasDescribe`); add a composer on an open canvas: "add a branch about X", "critique the whole map" → the model returns graph deltas (same zod schema as `lib/seed.ts`) applied to the live board.

### B3. Hybrid search for Documents (BM25 + vector)

- Add SQLite FTS5 (built into better-sqlite3) over `document_chunks`.
- Merge BM25 and cosine scores at retrieval time; covers exact-term queries that small embedding models miss.

### B4. Per-message generation stats

- Tokens, tokens/sec, time-to-first-token under each assistant message.
- Usage is available in `streamText`'s `onFinish`; persist alongside `parts`.

### B5. Background memory extraction

- Auto-run the extractor (on the utility model, A2) after a conversation goes idle, instead of the manual header button.
- Dedupe already handles repeats; add a per-conversation "last extracted" marker.

---

## C. Nice-to-haves

- **Export/import** conversations and canvases (Markdown/JSON) — fits the local-first ethos.
  - [x] Canvas → PNG whiteboard export (toolbar button, 2026-06-13). Markdown/JSON export and import still open.
- **Prompt/template library**, launchable like memory suggestions.
- **Side-by-side model comparison** — same prompt sent to two models.
- **Mobile-friendly layout** — Loom is already reachable over Tailscale; a usable phone view makes it a personal assistant everywhere.

---

## Suggested order

1. ~~A1 (MCP persistence/budget) — removes ~20s/message.~~ Done 2026-06-13.
2. ~~A2 (utility model) — makes every background AI action feel instant.~~ Done 2026-06-13.
3. ~~A4 (streaming bug) — trust.~~ Root-caused + hardened 2026-06-13.
4. ~~A3 (chat tool toggle)~~ Done 2026-06-13. **Section A complete** — B-items by appetite. **← next**
