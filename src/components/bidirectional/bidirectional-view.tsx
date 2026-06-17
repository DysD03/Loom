"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { UIMessage } from "ai";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  CircleStop,
  Flag,
  Flame,
  GitMerge,
  Lightbulb,
  Loader2,
  NotebookPen,
  Play,
  Rocket,
  Search,
  TriangleAlert,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import type { GoalStatus } from "@/db/schema";
import type {
  BridgeResult,
  GoalEvent,
  GoalNode,
  ReconcileResult,
  ToolLogEntry,
} from "@/lib/bidirectional";
import type { LoadedRun } from "@/lib/bidirectional";
import {
  DEFAULT_GOAL_ROUNDS,
  GOAL_ROUNDS_MAX,
  GOAL_ROUNDS_MIN,
} from "@/lib/bidirectional-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelect } from "@/components/chat/model-select";
import { ContextMeter } from "@/components/chat/context-meter";
import { sendBidirectionalToEditorAction } from "@/app/editor/actions";
import { sendRunToCanvasAction } from "@/app/canvas/actions";

const STATUS_LABEL: Record<GoalStatus, string> = {
  planning: "Seeding the start & goal frontiers",
  expanding: "Expanding the frontiers",
  reconciling: "Checking for a meeting point",
  done: "Bridge found",
  stalled: "Stopped — no bridge within budget",
  error: "Error",
};

/** True while a run is still processing (not yet done / stalled / errored). */
function isNonTerminal(status: GoalStatus | null): boolean {
  return status === "planning" || status === "expanding" || status === "reconciling";
}

type ToolStatus = "running" | "done" | "error";
interface ToolInfo {
  detail: string;
  status: ToolStatus;
}

/** A small header window for a grounding tool; hover shows its last use. */
function ToolWindow({
  label,
  verb,
  icon: Icon,
  info,
}: {
  label: string;
  verb: string;
  icon: LucideIcon;
  info: ToolInfo | null;
}) {
  if (!info) return null;
  const running = info.status === "running";
  const error = info.status === "error";
  const cls = error
    ? "border-destructive/40 text-destructive bg-destructive/5"
    : running
      ? "border-neon-cyan/40 text-neon-cyan bg-neon-cyan/5"
      : "border-border/60 text-muted-foreground";
  const title = error
    ? `${label} failed — ${info.detail || "—"}`
    : `${label} last ${verb}: ${info.detail || "—"}`;
  return (
    <div
      className={`flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] leading-none ${cls}`}
      title={title}
      aria-label={title}
    >
      {running ? <Loader2 className="size-3 animate-spin" /> : <Icon className="size-3" />}
      <span>{label}</span>
    </div>
  );
}

function fmtTime(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** A small, scrollable window of what SearXNG/Firecrawl researched, and when. */
function ResearchLog({ entries }: { entries: ToolLogEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <details className="border-border/70 bg-card/40 rounded-lg border p-3" open>
      <summary className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs font-medium tracking-wide uppercase">
        <Search className="size-3.5" /> Research log
        <span className="text-muted-foreground/70 lowercase">· {entries.length} lookups</span>
      </summary>
      <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
        {entries.map((e, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px]">
            <span className="text-muted-foreground/70 shrink-0 font-mono">{fmtTime(e.at)}</span>
            {e.tool === "searxng" ? (
              <Search className="text-neon-cyan mt-0.5 size-3 shrink-0" />
            ) : (
              <Flame className="text-neon-magenta mt-0.5 size-3 shrink-0" />
            )}
            <span className={e.status === "error" ? "text-destructive" : "text-foreground/80"}>
              <span className="text-muted-foreground">
                {e.tool === "searxng" ? "searched" : "scraped"}
              </span>{" "}
              {e.detail}
              {e.status === "error" ? " (failed)" : ""}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function NodeCard({
  node,
  highlight,
}: {
  node: GoalNode;
  highlight: boolean;
}) {
  const forward = node.side === "forward";
  const idClass = forward
    ? "border-neon-cyan/40 text-neon-cyan"
    : "border-neon-magenta/40 text-neon-magenta";
  return (
    <div
      className={
        "space-y-1.5 rounded-lg border p-2.5 transition-colors " +
        (highlight
          ? "border-neon-green/60 bg-neon-green/5 shadow-[0_0_10px_-2px_var(--neon-green)]"
          : "border-border/70 bg-card/40")
      }
    >
      <div className="flex items-center gap-2">
        <span
          className={`${idClass} rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wide`}
        >
          {node.id}
        </span>
        <span className="text-muted-foreground font-mono text-[10px]">
          cost {node.costFromOrigin}
        </span>
        {highlight ? <span className="text-neon-green text-[10px]">best pair</span> : null}
      </div>
      <p className="text-foreground/90 text-xs leading-snug">{node.description}</p>
      {node.establishedFacts.length > 0 ? (
        <ul className="space-y-0.5">
          {node.establishedFacts.map((f, i) => (
            <li key={i} className="text-neon-green/90 text-[11px]">
              ✓ {f}
            </li>
          ))}
        </ul>
      ) : null}
      {node.requiredConditions.length > 0 ? (
        <ul className="space-y-0.5">
          {node.requiredConditions.map((c, i) => (
            <li key={i} className="text-muted-foreground text-[11px]">
              ▸ needs {c}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ReconcilePanel({ result }: { result: ReconcileResult }) {
  return (
    <div className="border-border/70 bg-card/40 space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
        <GitMerge className="text-neon-magenta size-3.5" />
        Reconciler
        {result.bestPair ? (
          <span className="text-muted-foreground">
            best match {result.bestPair.forwardId} ⨁ {result.bestPair.backwardId} ·{" "}
            <span className="text-foreground">{Math.round(result.bestPair.score * 100)}%</span>
          </span>
        ) : (
          <span className="text-muted-foreground">no overlap yet</span>
        )}
      </div>

      {result.unmetConditions.length > 0 ? (
        <div>
          <p className="text-muted-foreground/80 mb-1 text-[10px] tracking-wide uppercase">
            Still unmet
          </p>
          <ul className="space-y-0.5">
            {result.unmetConditions.map((c, i) => (
              <li key={i} className="text-muted-foreground text-[11px]">
                · {c}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.hintToForward ? (
        <p className="text-[11px]">
          <span className="text-neon-cyan">→ forward:</span>{" "}
          <span className="text-muted-foreground">{result.hintToForward}</span>
        </p>
      ) : null}
      {result.hintToBackward ? (
        <p className="text-[11px]">
          <span className="text-neon-magenta">← backward:</span>{" "}
          <span className="text-muted-foreground">{result.hintToBackward}</span>
        </p>
      ) : null}
    </div>
  );
}

function BridgePanel({ bridge, summary }: { bridge: BridgeResult; summary: string | null }) {
  return (
    <div className="border-neon-green/50 bg-neon-green/5 space-y-3 rounded-lg border p-4 shadow-[0_0_16px_-6px_var(--neon-green)]">
      <div className="text-neon-green flex items-center gap-2 text-sm font-medium tracking-wide uppercase">
        <CheckCircle2 className="size-4" />
        Bridge found · total cost {bridge.totalCost}
      </div>
      {summary ? (
        <p className="text-foreground/90 border-neon-green/20 border-l-2 pl-3 text-sm leading-relaxed">
          {summary}
        </p>
      ) : null}
      <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
        Path
      </div>
      <ol className="space-y-1.5">
        {bridge.path.map((step, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className="text-muted-foreground mt-0.5 font-mono text-[11px]">{i + 1}.</span>
            <span className="text-foreground/90">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function BidirectionalView({
  conversationId,
  title,
  model,
  initialRun,
}: {
  conversationId: string;
  title: string;
  model: string | null;
  initialRun: LoadedRun | null;
}) {
  const router = useRouter();

  const [problemSpec, setProblemSpec] = useState(initialRun?.problemSpec ?? "");
  const [startState, setStartState] = useState(initialRun?.startState ?? "");
  const [goalState, setGoalState] = useState(initialRun?.goalState ?? "");
  const [maxRounds, setMaxRounds] = useState(initialRun?.maxRounds ?? DEFAULT_GOAL_ROUNDS);

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<GoalStatus | null>(initialRun?.status ?? null);
  const [forward, setForward] = useState<GoalNode[]>(initialRun?.forward ?? []);
  const [backward, setBackward] = useState<GoalNode[]>(initialRun?.backward ?? []);
  const [reconcile, setReconcile] = useState<ReconcileResult | null>(
    initialRun?.reconcile ?? null,
  );
  const [bridge, setBridge] = useState<BridgeResult | null>(initialRun?.bridge ?? null);
  const [summary, setSummary] = useState<string | null>(initialRun?.summary ?? null);
  const [recommendations, setRecommendations] = useState<string[]>(
    initialRun?.recommendations ?? [],
  );
  const [toolLog, setToolLog] = useState<ToolLogEntry[]>(initialRun?.toolLog ?? []);
  const [round, setRound] = useState<{ index: number; max: number } | null>(null);
  const [error, setError] = useState<string | null>(initialRun?.error ?? null);
  const [isExporting, setIsExporting] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [toolState, setToolState] = useState<{
    searxng: ToolInfo | null;
    firecrawl: ToolInfo | null;
  }>({ searxng: null, firecrawl: null });
  const scrollRef = useRef<HTMLDivElement>(null);
  // Aborts the in-flight run stream when the user cancels.
  const abortRef = useRef<AbortController | null>(null);
  // Set when a bridge arrives mid-stream, so we can auto-open the canvas once the
  // run finishes (without auto-firing on an already-loaded past run).
  const freshBridgeRef = useRef(false);
  const runningRef = useRef(false);
  // The status the page loaded with — used once to decide whether to start polling.
  const initialStatusRef = useRef<GoalStatus | null>(initialRun?.status ?? null);

  const bestForward = reconcile?.bestPair?.forwardId ?? bridge?.forwardId ?? null;
  const bestBackward = reconcile?.bestPair?.backwardId ?? bridge?.backwardId ?? null;

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  // Applies a persisted run snapshot to the live view (used by reload polling).
  const applyRun = useCallback((run: LoadedRun) => {
    setForward(run.forward);
    setBackward(run.backward);
    setReconcile(run.reconcile);
    setBridge(run.bridge);
    setSummary(run.summary);
    setRecommendations(run.recommendations);
    setToolLog(run.toolLog);
    setStatus(run.status);
    setError(run.error);
  }, []);

  // A run keeps going server-side even if the page is reloaded mid-flight. If we
  // loaded while one was still processing, poll the persisted run until it ends
  // so the view catches up to the work the model is still doing in the background.
  useEffect(() => {
    if (!isNonTerminal(initialStatusRef.current)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    async function poll() {
      if (cancelled) return;
      attempts += 1;
      if (!runningRef.current) {
        try {
          const res = await fetch(
            `/api/bidirectional?conversationId=${encodeURIComponent(conversationId)}`,
          );
          if (res.ok) {
            const data = (await res.json()) as { run: LoadedRun | null };
            if (!cancelled && data.run) {
              applyRun(data.run);
              if (!isNonTerminal(data.run.status)) return; // finished — stop polling
            }
          }
        } catch {
          // transient — keep polling
        }
      }
      if (!cancelled && attempts < 400) timer = setTimeout(poll, 2500);
    }

    timer = setTimeout(poll, 2500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [conversationId, applyRun]);

  // A synthetic transcript so the context meter reflects this run's pressure on
  // the model's context window (framing + both frontiers + the stitched bridge).
  const contextMessages = useMemo<UIMessage[]>(() => {
    const msgs: UIMessage[] = [];
    const framing = [
      problemSpec,
      startState ? `Start: ${startState}` : "",
      goalState ? `Goal: ${goalState}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (framing) msgs.push({ id: "framing", role: "user", parts: [{ type: "text", text: framing }] });
    const nodeText = [...forward, ...backward]
      .map((n) => `${n.description} ${n.establishedFacts.join(" ")} ${n.requiredConditions.join(" ")}`)
      .join("\n");
    const body = [nodeText, bridge?.path.join("\n") ?? ""].filter(Boolean).join("\n\n");
    if (body) msgs.push({ id: "ctx", role: "assistant", parts: [{ type: "text", text: body }] });
    return msgs;
  }, [problemSpec, startState, goalState, forward, backward, bridge]);

  async function handleSendToCanvas() {
    if (isSeeding) return;
    setIsSeeding(true);
    const toastId = toast.loading("Building the solution canvas…");
    try {
      const result = await sendRunToCanvasAction(conversationId);
      if ("error" in result) {
        toast.error("Send to Canvas failed", { id: toastId, description: result.error });
        return;
      }
      toast.success("Canvas created — opening", { id: toastId });
      router.push(`/canvas?c=${result.canvasId}`);
    } catch {
      toast.error("Send to Canvas failed", { id: toastId });
    } finally {
      setIsSeeding(false);
    }
  }

  async function handleSendToEditor() {
    if (isExporting) return;
    setIsExporting(true);
    const toastId = toast.loading("Saving the final answer to the editor…");
    try {
      const result = await sendBidirectionalToEditorAction(conversationId);
      if ("error" in result) {
        toast.error("Send to Editor failed", { id: toastId, description: result.error });
        return;
      }
      toast.success("Opened in editor", { id: toastId });
      router.push(`/editor?d=${result.docId}`);
    } catch {
      toast.error("Send to Editor failed", { id: toastId });
    } finally {
      setIsExporting(false);
    }
  }

  function handleEvent(event: GoalEvent) {
    switch (event.type) {
      case "status":
        setStatus(event.status);
        break;
      case "init":
        setForward(event.forward);
        setBackward(event.backward);
        break;
      case "round":
        setRound({ index: event.index, max: event.max });
        break;
      case "nodes":
        for (const node of event.nodes) {
          if (node.side === "forward") {
            setForward((prev) => [...prev, node]);
          } else {
            setBackward((prev) => [...prev, node]);
          }
        }
        break;
      case "reconcile":
        setReconcile(event.result);
        break;
      case "bridge":
        setBridge(event.bridge);
        freshBridgeRef.current = true;
        break;
      case "summary":
        setSummary(event.text);
        break;
      case "recommendations":
        setRecommendations(event.items);
        break;
      case "tool": {
        setToolState((prev) => ({
          ...prev,
          [event.tool]: { detail: event.detail, status: event.status },
        }));
        // Log only completed actions ("what was researched when").
        if (event.status === "done" || event.status === "error") {
          const entry: ToolLogEntry = {
            tool: event.tool,
            detail: event.detail,
            status: event.status,
            at: event.at,
          };
          setToolLog((prev) => [...prev, entry]);
        }
        break;
      }
      case "error":
        setError(event.message);
        setStatus("error");
        break;
      case "done":
        break;
    }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }

  async function run() {
    if (running || !startState.trim() || !goalState.trim()) return;

    setRunning(true);
    setError(null);
    setForward([]);
    setBackward([]);
    setReconcile(null);
    setBridge(null);
    setSummary(null);
    setRecommendations([]);
    setRound(null);
    setToolState({ searxng: null, firecrawl: null });
    setToolLog([]);
    setStatus("planning");
    freshBridgeRef.current = false;

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch("/api/bidirectional", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          conversationId,
          problemSpec: problemSpec.trim(),
          startState: startState.trim(),
          goalState: goalState.trim(),
          maxRounds,
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            handleEvent(JSON.parse(line) as GoalEvent);
          } catch {
            // ignore malformed line fragments
          }
        }
      }
    } catch (err) {
      // A user cancel aborts the fetch — that's a graceful stop, not an error.
      if (ac.signal.aborted) {
        setStatus("stalled");
      } else {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
      setCancelling(false);
      setRound(null);
      router.refresh();
    }

    // Bridging is done — automatically build + open the solution canvas (skip if cancelled).
    if (freshBridgeRef.current && !ac.signal.aborted) {
      freshBridgeRef.current = false;
      await handleSendToCanvas();
    }
  }

  /** Cancels the run: tells the server to abort, and stops our own stream. */
  async function cancel() {
    if (cancelling) return;
    setCancelling(true);
    try {
      await fetch(`/api/bidirectional?conversationId=${encodeURIComponent(conversationId)}`, {
        method: "DELETE",
      });
    } catch {
      // ignore — we still abort locally below
    }
    // Abort a local stream if we're driving one; for a background (reloaded) run
    // there's nothing local to abort, so reflect the stop directly.
    abortRef.current?.abort();
    setStatus("stalled");
    setCancelling(false);
  }

  const busy = running && status !== null && status !== "done" && status !== "error";
  // A run is processing on the server but we're not the ones streaming it (e.g.
  // the page was reloaded mid-run); the poller is keeping the view fresh.
  const backgroundBusy = !running && isNonTerminal(status);
  const locked = running || backgroundBusy;
  const hasRun = forward.length > 0 || backward.length > 0;

  // Current round: the live stream reports it directly; a polled/background run
  // doesn't, so estimate it from expanded-node counts (one expansion per side
  // per round). null when no run is active.
  const elapsedRounds = Math.max(
    forward.filter((n) => n.expanded).length,
    backward.filter((n) => n.expanded).length,
  );
  const currentRound =
    round ?? (locked && elapsedRounds > 0 ? { index: elapsedRounds, max: maxRounds } : null);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-6">
        <h1 className="truncate text-base font-semibold">{title}</h1>
        <div className="flex items-center gap-2">
          {currentRound ? (
            <div
              className="border-neon-cyan/40 bg-neon-cyan/5 text-neon-cyan flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] leading-none"
              title="Search round"
              aria-live="polite"
            >
              <Loader2 className="size-3 animate-spin" />
              <span>
                ROUND <span className="font-semibold">{currentRound.index}</span>/{currentRound.max}
              </span>
            </div>
          ) : null}
          <ToolWindow label="SearXNG" verb="searched" icon={Search} info={toolState.searxng} />
          <ToolWindow label="Firecrawl" verb="scraped" icon={Flame} info={toolState.firecrawl} />
          <ContextMeter messages={contextMessages} model={model} />
          <ModelSelect conversationId={conversationId} current={model} type="experimental" />
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendToCanvas}
            disabled={isSeeding || locked || (forward.length === 0 && backward.length === 0)}
          >
            <Workflow className="size-4" />
            {isSeeding ? "Building…" : "Send to Canvas"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendToEditor}
            disabled={isExporting || locked || (!bridge && !reconcile)}
          >
            <NotebookPen className="size-4" />
            {isExporting ? "Saving…" : "Send to Editor"}
          </Button>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-6">
          {/* Setup form */}
          <div className="border-border/70 bg-card/40 space-y-3 rounded-lg border p-3">
            <div className="space-y-1">
              <label htmlFor="goal-spec" className="text-muted-foreground text-xs font-medium">
                Problem spec (domain framing + a shared glossary — what counts as “one bounded step”)
              </label>
              <Textarea
                id="goal-spec"
                value={problemSpec}
                onChange={(e) => setProblemSpec(e.target.value)}
                placeholder="e.g. Plan a weekend backpacking trip. A step = one concrete preparation/booking action. Use consistent terms: 'trail', 'permit', 'gear'."
                rows={2}
                disabled={locked}
                className="max-h-40 min-h-[52px] resize-none"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label
                  htmlFor="goal-start"
                  className="text-neon-cyan flex items-center gap-1.5 text-xs font-medium"
                >
                  <Rocket className="size-3.5" /> Start state
                </label>
                <Textarea
                  id="goal-start"
                  value={startState}
                  onChange={(e) => setStartState(e.target.value)}
                  placeholder="Where you are now."
                  rows={3}
                  disabled={locked}
                  className="max-h-48 min-h-[72px] resize-none"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="goal-goal"
                  className="text-neon-magenta flex items-center gap-1.5 text-xs font-medium"
                >
                  <Flag className="size-3.5" /> Goal state
                </label>
                <Textarea
                  id="goal-goal"
                  value={goalState}
                  onChange={(e) => setGoalState(e.target.value)}
                  placeholder="What you want to be true."
                  rows={3}
                  disabled={locked}
                  className="max-h-48 min-h-[72px] resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <label className="text-muted-foreground flex items-center gap-2 text-[11px]">
                Max rounds
                <Input
                  type="number"
                  min={GOAL_ROUNDS_MIN}
                  max={GOAL_ROUNDS_MAX}
                  value={maxRounds}
                  disabled={locked}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) {
                      setMaxRounds(Math.min(GOAL_ROUNDS_MAX, Math.max(GOAL_ROUNDS_MIN, n)));
                    }
                  }}
                  className="h-8 w-16"
                />
              </label>
              {locked ? (
                <Button onClick={cancel} disabled={cancelling} variant="destructive" size="sm">
                  {cancelling ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Cancelling…
                    </>
                  ) : (
                    <>
                      <CircleStop className="size-4" /> Cancel search
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={run}
                  disabled={!startState.trim() || !goalState.trim()}
                  size="sm"
                >
                  <Play className="size-4" /> Run search
                </Button>
              )}
            </div>
          </div>

          {/* Live status */}
          {busy || backgroundBusy ? (
            <div className="text-neon-cyan flex items-center gap-2 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              {status ? STATUS_LABEL[status] : "Working…"}
              {backgroundBusy ? (
                <span className="text-muted-foreground">· running in background — auto-updating</span>
              ) : null}
            </div>
          ) : null}

          {/* Research log — what SearXNG/Firecrawl looked up, and when */}
          <ResearchLog entries={toolLog} />

          {/* Error */}
          {error ? (
            <div className="border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <p>{error}</p>
            </div>
          ) : null}

          {/* Bridge result */}
          {bridge ? <BridgePanel bridge={bridge} summary={summary} /> : null}

          {/* Stopped without a bridge */}
          {!locked && !bridge && status === "stalled" ? (
            <div className="border-border/70 text-muted-foreground flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
              <CircleDot className="mt-0.5 size-4 shrink-0" />
              <p>
                No full bridge was found within the round budget — the closest match and remaining
                gaps are shown below. Consider the recommended alternatives, or try raising max
                rounds, sharpening the goal, or adding a shared glossary to the problem spec.
              </p>
            </div>
          ) : null}

          {/* Recommended alternatives (no bridge found) */}
          {!bridge && recommendations.length > 0 ? (
            <div className="border-neon-yellow/40 bg-neon-yellow/5 space-y-2 rounded-lg border p-4">
              <div className="text-neon-yellow flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
                <Lightbulb className="size-3.5" />
                Recommended alternatives to pursue
              </div>
              <ul className="space-y-1.5">
                {recommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-neon-yellow mt-0.5 shrink-0 font-medium">{i + 1}.</span>
                    <span className="text-foreground/90">{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Reconciler verdict */}
          {reconcile ? <ReconcilePanel result={reconcile} /> : null}

          {/* Two frontiers */}
          {hasRun ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="text-neon-cyan flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
                  <Rocket className="size-3.5" /> Forward frontier
                  <ArrowRight className="size-3" />
                </div>
                {forward.map((n) => (
                  <NodeCard key={n.id} node={n} highlight={n.id === bestForward} />
                ))}
              </div>
              <div className="space-y-2">
                <div className="text-neon-magenta flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
                  <Flag className="size-3.5" /> Backward frontier
                </div>
                {backward.map((n) => (
                  <NodeCard key={n.id} node={n} highlight={n.id === bestBackward} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
