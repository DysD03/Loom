"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { UIMessage } from "ai";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Flag,
  GitMerge,
  Loader2,
  NotebookPen,
  Play,
  Rocket,
  TriangleAlert,
  Workflow,
} from "lucide-react";

import type { GoalStatus } from "@/db/schema";
import type {
  BridgeResult,
  GoalEvent,
  GoalNode,
  ReconcileResult,
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

function BridgePanel({ bridge }: { bridge: BridgeResult }) {
  return (
    <div className="border-neon-green/50 bg-neon-green/5 space-y-3 rounded-lg border p-4 shadow-[0_0_16px_-6px_var(--neon-green)]">
      <div className="text-neon-green flex items-center gap-2 text-sm font-medium tracking-wide uppercase">
        <CheckCircle2 className="size-4" />
        Bridge found · total cost {bridge.totalCost}
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
  const [round, setRound] = useState<{ index: number; max: number } | null>(null);
  const [error, setError] = useState<string | null>(initialRun?.error ?? null);
  const [isExporting, setIsExporting] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Set when a bridge arrives mid-stream, so we can auto-open the canvas once the
  // run finishes (without auto-firing on an already-loaded past run).
  const freshBridgeRef = useRef(false);

  const bestForward = reconcile?.bestPair?.forwardId ?? bridge?.forwardId ?? null;
  const bestBackward = reconcile?.bestPair?.backwardId ?? bridge?.backwardId ?? null;

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
    setRound(null);
    setStatus("planning");
    freshBridgeRef.current = false;

    try {
      const res = await fetch("/api/bidirectional", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    } finally {
      setRunning(false);
      setRound(null);
      router.refresh();
    }

    // Bridging is done — automatically build + open the solution canvas.
    if (freshBridgeRef.current) {
      freshBridgeRef.current = false;
      await handleSendToCanvas();
    }
  }

  const busy = running && status !== null && status !== "done" && status !== "error";
  const hasRun = forward.length > 0 || backward.length > 0;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-6">
        <h1 className="truncate text-base font-semibold">{title}</h1>
        <div className="flex items-center gap-2">
          <ContextMeter messages={contextMessages} model={model} />
          <ModelSelect conversationId={conversationId} current={model} type="experimental" />
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendToCanvas}
            disabled={isSeeding || running || (forward.length === 0 && backward.length === 0)}
          >
            <Workflow className="size-4" />
            {isSeeding ? "Building…" : "Send to Canvas"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendToEditor}
            disabled={isExporting || running || (!bridge && !reconcile)}
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
                disabled={running}
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
                  disabled={running}
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
                  disabled={running}
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
                  disabled={running}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) {
                      setMaxRounds(Math.min(GOAL_ROUNDS_MAX, Math.max(GOAL_ROUNDS_MIN, n)));
                    }
                  }}
                  className="h-8 w-16"
                />
              </label>
              <Button onClick={run} disabled={running || !startState.trim() || !goalState.trim()} size="sm">
                {running ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Searching…
                  </>
                ) : (
                  <>
                    <Play className="size-4" /> Run search
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Live status */}
          {busy ? (
            <div className="text-neon-cyan flex items-center gap-2 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              {status ? STATUS_LABEL[status] : "Working…"}
              {round ? (
                <span className="text-muted-foreground">
                  · round {round.index}/{round.max}
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Error */}
          {error ? (
            <div className="border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <p>{error}</p>
            </div>
          ) : null}

          {/* Bridge result */}
          {bridge ? <BridgePanel bridge={bridge} /> : null}

          {/* Stopped without a bridge */}
          {!running && !bridge && status === "stalled" ? (
            <div className="border-border/70 text-muted-foreground flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
              <CircleDot className="mt-0.5 size-4 shrink-0" />
              <p>
                No full bridge was found within the round budget. The closest match and remaining
                gaps are shown below — try raising max rounds, sharpening the goal, or adding a shared
                glossary to the problem spec.
              </p>
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
