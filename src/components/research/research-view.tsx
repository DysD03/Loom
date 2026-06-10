"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { UIMessage } from "ai";
import { toast } from "sonner";
import {
  ExternalLink,
  Lightbulb,
  Loader2,
  NotebookPen,
  Search,
  Sparkles,
  Target,
  TriangleAlert,
  Workflow,
} from "lucide-react";

import type { ResearchStatus } from "@/db/schema";
import type { ResearchConfig } from "@/lib/research-config";
import type {
  LoadedReport,
  ResearchEvent,
  ResearchRound,
  ResearchSource,
} from "@/lib/research";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { CopyButton } from "@/components/copy-button";
import { ModelSelect } from "@/components/chat/model-select";
import { ContextMeter } from "@/components/chat/context-meter";
import { ResearchSettings } from "@/components/research/research-settings";
import { sendToCanvasAction } from "@/app/canvas/actions";
import { sendReportToEditorAction } from "@/app/editor/actions";
import { SendToOpencodeButton } from "@/components/opencode/send-button";

const STATUS_LABEL: Record<ResearchStatus, string> = {
  planning: "Planning the investigation",
  searching: "Searching the web",
  reading: "Reading sources",
  reflecting: "Reflecting on findings",
  writing: "Writing the report",
  done: "Done",
  error: "Error",
};

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function RoundCard({
  round,
  reading,
  active,
}: {
  round: ResearchRound;
  reading: { index: number; total: number; title: string } | null;
  active: boolean;
}) {
  return (
    <div className="border-border/70 bg-card/40 space-y-2.5 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="border-neon-cyan/40 text-neon-cyan rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wide">
          ROUND {round.index}/{round.max}
        </span>
        {active ? <Loader2 className="text-neon-cyan size-3.5 animate-spin" /> : null}
        {round.sufficient ? (
          <span className="text-neon-green text-[11px]">evidence sufficient</span>
        ) : null}
      </div>

      <p className="text-muted-foreground flex items-start gap-1.5 text-[11px]">
        <Target className="mt-0.5 size-3 shrink-0" />
        <span className="min-w-0 flex-1">{round.goal}</span>
      </p>

      {round.queries.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {round.queries.map((q) => (
            <span
              key={q}
              className="border-border/70 bg-muted/40 text-muted-foreground rounded border px-1.5 py-0.5 text-[11px]"
            >
              {q}
            </span>
          ))}
        </div>
      ) : null}

      {active && reading ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <Loader2 className="size-3 animate-spin" />
          Reading {reading.index}/{reading.total}: {reading.title}
        </p>
      ) : null}

      {round.learnings.length > 0 ? (
        <ul className="space-y-1">
          {round.learnings.map((l, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs">
              <Lightbulb className="text-neon-green mt-0.5 size-3 shrink-0" />
              <span className="text-foreground/90">{l}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {round.gaps.length > 0 && !round.sufficient ? (
        <div className="border-border/50 border-t pt-2">
          <p className="text-muted-foreground/80 mb-1 text-[10px] tracking-wide uppercase">
            Still missing
          </p>
          <ul className="space-y-0.5">
            {round.gaps.map((g, i) => (
              <li key={i} className="text-muted-foreground text-[11px]">
                · {g}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ResearchView({
  conversationId,
  title,
  model,
  initialReport,
  config,
}: {
  conversationId: string;
  title: string;
  model: string | null;
  initialReport: LoadedReport | null;
  config: ResearchConfig;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasReport = Boolean(initialReport && initialReport.report);

  // Prefill the question when launched from a memory suggestion (?seed=…).
  const [question, setQuestion] = useState(() =>
    initialReport ? "" : (searchParams.get("seed") ?? ""),
  );
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<ResearchStatus | null>(
    initialReport ? initialReport.status : null,
  );
  const [rounds, setRounds] = useState<ResearchRound[]>(initialReport?.rounds ?? []);
  const [sources, setSources] = useState<ResearchSource[]>(initialReport?.sources ?? []);
  const [reading, setReading] = useState<{ index: number; total: number; title: string } | null>(
    null,
  );
  const [report, setReport] = useState(initialReport?.report ?? "");
  const [error, setError] = useState<string | null>(initialReport?.error ?? null);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const usedSources = sources.filter((s) => s.used);
  const otherSources = sources.filter((s) => !s.used);
  const activeRound = running ? rounds[rounds.length - 1]?.index : undefined;

  // A synthetic transcript so the context meter reflects the model's context
  // pressure for this run (question + gathered findings + report + snippets).
  const contextMessages = useMemo<UIMessage[]>(() => {
    const msgs: UIMessage[] = [];
    const q = (initialReport?.question ?? question).trim();
    if (q) msgs.push({ id: "q", role: "user", parts: [{ type: "text", text: q }] });
    const findings = rounds.flatMap((r) => r.learnings).join("\n");
    const snippets = sources.map((s) => s.snippet).join("\n");
    const body = [findings, snippets, report].filter(Boolean).join("\n\n");
    if (body) msgs.push({ id: "ctx", role: "assistant", parts: [{ type: "text", text: body }] });
    return msgs;
  }, [initialReport, question, rounds, sources, report]);

  function handleEvent(event: ResearchEvent) {
    switch (event.type) {
      case "status":
        setStage(event.status);
        break;
      case "plan":
        // The initial queries also arrive as round 1's queries; nothing to do.
        break;
      case "round":
        setReading(null);
        setRounds((prev) => [
          ...prev,
          {
            index: event.index,
            max: event.max,
            goal: event.goal,
            queries: event.queries,
            learnings: [],
            gaps: [],
            sufficient: false,
          },
        ]);
        break;
      case "sources":
        setSources(event.sources);
        break;
      case "reading":
        setReading({ index: event.index, total: event.total, title: event.title });
        break;
      case "reflection":
        setReading(null);
        setRounds((prev) =>
          prev.map((r) =>
            r.index === event.round
              ? {
                  ...r,
                  learnings: event.learnings,
                  gaps: event.gaps,
                  sufficient: event.sufficient,
                }
              : r,
          ),
        );
        break;
      case "report-delta":
        setReport((prev) => prev + event.delta);
        break;
      case "error":
        setError(event.message);
        setStage("error");
        break;
      case "done":
        setStage("done");
        break;
    }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }

  async function run() {
    const q = question.trim();
    if (!q || running) return;

    setRunning(true);
    setError(null);
    setReport("");
    setRounds([]);
    setSources([]);
    setReading(null);
    setStage("planning");

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, question: q }),
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
            handleEvent(JSON.parse(line) as ResearchEvent);
          } catch {
            // ignore malformed line fragments
          }
        }
      }
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("error");
    } finally {
      setRunning(false);
      setReading(null);
      router.refresh();
    }
  }

  async function handleSendToCanvas() {
    if (isSeeding) return;
    setIsSeeding(true);
    const toastId = toast.loading("Building a canvas from this report…");
    try {
      const result = await sendToCanvasAction(conversationId, "research");
      if ("error" in result) {
        toast.error("Send to Canvas failed", { id: toastId, description: result.error });
        return;
      }
      toast.success("Canvas created", { id: toastId });
      router.push(`/canvas?c=${result.canvasId}`);
    } catch {
      toast.error("Send to Canvas failed", {
        id: toastId,
        description: "Check the model connection in Settings.",
      });
    } finally {
      setIsSeeding(false);
    }
  }

  async function handleSendToEditor() {
    if (isExporting) return;
    setIsExporting(true);
    const toastId = toast.loading("Sending the report to the editor…");
    try {
      const result = await sendReportToEditorAction(conversationId);
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

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      run();
    }
  }

  const busy = running && stage !== null && stage !== "done" && stage !== "error";

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-6">
        <h1 className="truncate text-base font-semibold">{title}</h1>
        <div className="flex items-center gap-2">
          <ContextMeter messages={contextMessages} model={model} />
          <ModelSelect conversationId={conversationId} current={model} type="research" />
          <ResearchSettings conversationId={conversationId} config={config} disabled={running} />
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendToEditor}
            disabled={isExporting || running || !report}
          >
            <NotebookPen className="size-4" />
            {isExporting ? "Sending…" : "Send to Editor"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendToCanvas}
            disabled={isSeeding || running || !report}
          >
            <Workflow className="size-4" />
            {isSeeding ? "Building…" : "Send to Canvas"}
          </Button>
          <SendToOpencodeButton sourceId={conversationId} kind="research" disabled={running || !report} />
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-6">
          {/* Composer */}
          <div className="border-border/70 bg-card/40 space-y-2 rounded-lg border p-3">
            <label htmlFor="research-q" className="text-muted-foreground text-xs font-medium">
              {hasReport ? "Ask a follow-up / new question" : "What should Loom research?"}
            </label>
            <Textarea
              id="research-q"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. What are the trade-offs between SQLite and Postgres for a local-first app?"
              rows={2}
              disabled={running}
              className="max-h-40 min-h-[56px] resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-[11px]">⌘/Ctrl + Enter to run</span>
              <Button onClick={run} disabled={running || !question.trim()} size="sm">
                {running ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Researching…
                  </>
                ) : (
                  <>
                    <Search className="size-4" /> Run research
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Live activity badge */}
          {busy ? (
            <div className="text-neon-cyan flex items-center gap-2 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              {stage ? STATUS_LABEL[stage] : "Working…"}
            </div>
          ) : null}

          {/* Research log — one card per round */}
          {rounds.length > 0 ? (
            <div className="space-y-2.5">
              {rounds.map((r) => (
                <RoundCard
                  key={r.index}
                  round={r}
                  reading={reading}
                  active={running && r.index === activeRound}
                />
              ))}
            </div>
          ) : null}

          {/* Error */}
          {error ? (
            <div className="border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <p>{error}</p>
            </div>
          ) : null}

          {/* Report */}
          {report ? (
            <div className="group space-y-3">
              <div className="text-neon-cyan flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
                <Sparkles className="size-3.5" />
                Report
                {running && stage === "writing" ? (
                  <span className="bg-neon-cyan animate-blink inline-block h-3 w-1.5" />
                ) : null}
              </div>
              <Markdown>{report}</Markdown>
              {!running ? (
                <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <CopyButton value={report} label="Copy report" />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Sources */}
          {usedSources.length > 0 ? (
            <div className="border-border/70 space-y-2 rounded-lg border p-4">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Sources
              </p>
              <ol className="space-y-1.5">
                {usedSources.map((s, i) => (
                  <li key={s.url} className="flex gap-2 text-sm">
                    <span className="text-neon-magenta shrink-0 font-medium">[{i + 1}]</span>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group/src min-w-0 flex-1"
                    >
                      <span className="group-hover/src:text-neon-cyan block truncate">
                        {s.title || s.url}
                      </span>
                      <span className="text-muted-foreground flex items-center gap-1 truncate text-[11px]">
                        <ExternalLink className="size-3 shrink-0" />
                        {hostname(s.url)}
                      </span>
                    </a>
                  </li>
                ))}
              </ol>

              {otherSources.length > 0 ? (
                <details className="pt-1">
                  <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-[11px]">
                    {otherSources.length} more result{otherSources.length === 1 ? "" : "s"} found
                    (not cited)
                  </summary>
                  <ul className="mt-1.5 space-y-1">
                    {otherSources.map((s) => (
                      <li key={s.url} className="truncate text-[11px]">
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-neon-cyan"
                        >
                          {s.title || s.url} · {hostname(s.url)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
