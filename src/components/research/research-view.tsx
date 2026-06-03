"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  CircleDashed,
  ExternalLink,
  Loader2,
  Search,
  Sparkles,
  TriangleAlert,
  Workflow,
} from "lucide-react";

import type { ResearchStatus } from "@/db/schema";
import type { LoadedReport, ResearchEvent, ResearchSource } from "@/lib/research";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { CopyButton } from "@/components/copy-button";
import { ModelSelect } from "@/components/chat/model-select";
import { sendToCanvasAction } from "@/app/canvas/actions";

const STAGES: { key: ResearchStatus; label: string }[] = [
  { key: "planning", label: "Planning queries" },
  { key: "searching", label: "Searching the web" },
  { key: "reading", label: "Reading sources" },
  { key: "writing", label: "Writing report" },
];
const STAGE_ORDER: ResearchStatus[] = ["planning", "searching", "reading", "writing", "done"];

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function StageRow({
  label,
  state,
}: {
  label: string;
  state: "pending" | "active" | "done";
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {state === "done" ? (
        <Check className="text-neon-green size-3.5 shrink-0" />
      ) : state === "active" ? (
        <Loader2 className="text-neon-cyan size-3.5 shrink-0 animate-spin" />
      ) : (
        <CircleDashed className="text-muted-foreground/50 size-3.5 shrink-0" />
      )}
      <span
        className={
          state === "pending"
            ? "text-muted-foreground/50"
            : state === "active"
              ? "text-foreground"
              : "text-muted-foreground"
        }
      >
        {label}
      </span>
    </div>
  );
}

export function ResearchView({
  conversationId,
  title,
  model,
  initialReport,
}: {
  conversationId: string;
  title: string;
  model: string | null;
  initialReport: LoadedReport | null;
}) {
  const router = useRouter();
  const hasReport = Boolean(initialReport && initialReport.report);

  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<ResearchStatus | null>(
    initialReport ? initialReport.status : null,
  );
  const [queries, setQueries] = useState<string[]>(initialReport?.queries ?? []);
  const [sources, setSources] = useState<ResearchSource[]>(initialReport?.sources ?? []);
  const [reading, setReading] = useState<{ index: number; total: number; title: string } | null>(
    null,
  );
  const [report, setReport] = useState(initialReport?.report ?? "");
  const [error, setError] = useState<string | null>(initialReport?.error ?? null);
  const [isSeeding, setIsSeeding] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const stageIndex = stage ? STAGE_ORDER.indexOf(stage) : -1;
  const usedSources = sources.filter((s) => s.used);
  const otherSources = sources.filter((s) => !s.used);

  function handleEvent(event: ResearchEvent) {
    switch (event.type) {
      case "status":
        setStage(event.status);
        break;
      case "plan":
        setQueries(event.queries);
        break;
      case "sources":
        setSources(event.sources);
        break;
      case "reading":
        setReading({ index: event.index, total: event.total, title: event.title });
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
    setQueries([]);
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

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      run();
    }
  }

  const showProgress = running || (stage !== null && stage !== "done" && stage !== "error");

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-6">
        <h1 className="truncate text-base font-semibold">{title}</h1>
        <div className="flex items-center gap-2">
          <ModelSelect conversationId={conversationId} current={model} type="research" />
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendToCanvas}
            disabled={isSeeding || running || !report}
          >
            <Workflow className="size-4" />
            {isSeeding ? "Building…" : "Send to Canvas"}
          </Button>
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

          {/* Progress */}
          {showProgress ? (
            <div className="border-border/70 bg-card/40 space-y-3 rounded-lg border p-4">
              <div className="space-y-1.5">
                {STAGES.map((s) => {
                  const idx = STAGE_ORDER.indexOf(s.key);
                  const state =
                    stageIndex > idx ? "done" : stageIndex === idx ? "active" : "pending";
                  return <StageRow key={s.key} label={s.label} state={state} />;
                })}
              </div>

              {queries.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {queries.map((q) => (
                    <span
                      key={q}
                      className="border-border/70 bg-muted/40 text-muted-foreground rounded border px-1.5 py-0.5 text-[11px]"
                    >
                      {q}
                    </span>
                  ))}
                </div>
              ) : null}

              {reading ? (
                <p className="text-muted-foreground text-[11px]">
                  Reading {reading.index}/{reading.total}: {reading.title}
                </p>
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
                <div className="opacity-0 transition-opacity group-hover:opacity-100">
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
