"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Ban, Check, CircleAlert, Loader2, Trophy, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BarChart, ChartLegend, seriesColor } from "@/components/dashboards/charts";
import { CostPanel } from "./cost";
import type { TokenPrice } from "@/lib/benchmark-cost";
import { PerformancePanel } from "./performance";
import type { BenchmarkRunStatus } from "@/db/schema";
import {
  isTimingOnly,
  type RunSummaryView,
  type TaskCellView,
  type TaskRowView,
} from "@/lib/benchmark-score";
import { cancelRunAction } from "@/app/benchmarks/actions";

export interface RunViewData {
  id: string;
  title: string;
  suiteName: string;
  status: BenchmarkRunStatus;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Sampling temperature this run used; 0 means greedy and reproducible. */
  temperature: number;
}

export interface RunCostInfo {
  perHour: number;
  source: "snapshot" | "settings";
}

type TaskSort = { key: "task" | "category" | number; dir: 1 | -1 } | null;

/** True when any completed cell of the row failed a check or errored. */
function rowFailed(row: TaskRowView): boolean {
  return row.cells.some(
    (c) => c !== null && (c.error !== null || (!c.passed && !isTimingOnly(row.scoring))),
  );
}

function rowAllPassed(row: TaskRowView): boolean {
  const done = row.cells.filter((c): c is TaskCellView => c !== null);
  return done.length > 0 && done.every((c) => c.passed && c.error === null);
}

const STATUS_BADGE: Record<BenchmarkRunStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-neon-yellow/15 text-neon-yellow" },
  running: { label: "Running", className: "bg-neon-cyan/15 text-neon-cyan animate-pulse" },
  done: { label: "Done", className: "bg-neon-green/15 text-neon-green" },
  error: { label: "Error", className: "bg-destructive/15 text-destructive" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
};

function ChartCard({
  title,
  legend,
  children,
}: {
  title: string;
  legend?: { name: string; color: string }[];
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card/80 min-w-0 rounded-lg border p-4">
      <div className="mb-3 space-y-1.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {legend ? <ChartLegend series={legend} /> : null}
      </div>
      {children}
    </div>
  );
}

function CellMark({ cell, scoring }: { cell: TaskCellView | null; scoring: string }) {
  if (cell === null) {
    return <span className="text-muted-foreground/50">·</span>;
  }
  if (cell.error && cell.output === "") {
    return <CircleAlert className="text-neon-yellow mx-auto size-3.5" aria-label={cell.error} />;
  }
  if (scoring === "timing") {
    return (
      <span className="text-neon-cyan text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
        {(cell.latencyMs / 1000).toFixed(2)}s
      </span>
    );
  }
  if (scoring === "judge") {
    return (
      <span className={cn("text-xs", cell.passed ? "text-neon-green" : "text-destructive")}>
        {Math.round(cell.score * 100)}%
      </span>
    );
  }
  return cell.passed ? (
    <Check className="text-neon-green mx-auto size-3.5" aria-label="Passed" />
  ) : (
    <X className="text-destructive mx-auto size-3.5" aria-label="Failed" />
  );
}

export function RunView({
  run,
  summary,
  cost,
  pricing,
}: {
  run: RunViewData;
  summary: RunSummaryView;
  cost: RunCostInfo | null;
  pricing: TokenPrice[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openTask, setOpenTask] = useState<number | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "passed" | "failed">("all");
  const [taskSort, setTaskSort] = useState<TaskSort>(null);

  const live = run.status === "running" || run.status === "pending";
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => router.refresh(), 2_500);
    return () => clearInterval(timer);
  }, [live, router]);

  const badge = STATUS_BADGE[run.status];
  const labels = summary.models.map((m) => m.label);
  const modelColors = summary.models.map((_, i) => seriesColor(i));
  const leaderboard = [...summary.models]
    .map((m, i) => ({ ...m, color: modelColors[i] }))
    .sort((a, b) => b.score - a.score);
  const progress = summary.total > 0 ? summary.completed / summary.total : 0;
  const hasScored = summary.models.some((m) => m.scoredCompleted > 0);

  const wallClockMs =
    run.startedAt && run.finishedAt
      ? Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt))
      : null;

  const taskCategories = [...new Set(summary.tasks.map((t) => t.category))];
  const visibleTasks = summary.tasks
    .filter((t) => categoryFilter === "all" || t.category === categoryFilter)
    .filter((t) =>
      outcomeFilter === "all"
        ? true
        : outcomeFilter === "failed"
          ? rowFailed(t)
          : rowAllPassed(t),
    );
  if (taskSort) {
    const value = (row: TaskRowView): string | number =>
      taskSort.key === "task"
        ? row.name.toLowerCase()
        : taskSort.key === "category"
          ? row.category.toLowerCase()
          : (row.cells[taskSort.key]?.score ?? -1);
    visibleTasks.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * taskSort.dir;
    });
  }

  function toggleTaskSort(key: "task" | "category" | number) {
    setTaskSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === 1 ? -1 : 1 }
        : { key, dir: typeof key === "number" ? -1 : 1 },
    );
  }

  function sortIcon(key: "task" | "category" | number) {
    if (taskSort?.key !== key) return null;
    return taskSort.dir === 1 ? (
      <ArrowUp className="size-3" />
    ) : (
      <ArrowDown className="size-3" />
    );
  }

  function cancel() {
    startTransition(async () => {
      await cancelRunAction(run.id);
      router.refresh();
    });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{run.title}</p>
        <span className="text-muted-foreground hidden text-xs sm:inline">{run.suiteName}</span>
        <span
          className="text-muted-foreground hidden text-xs md:inline"
          title={
            run.temperature === 0
              ? "Greedy decoding — re-running this suite should reproduce these answers"
              : "Sampling is on, so accuracy will vary between runs"
          }
        >
          temp {run.temperature}
        </span>
        <Badge className={badge.className}>{badge.label}</Badge>
        {live ? (
          <Button variant="outline" size="sm" onClick={cancel} disabled={isPending} className="gap-1.5">
            <Ban className="size-3.5" />
            Cancel
          </Button>
        ) : null}
      </header>

      {run.status === "error" && run.error ? (
        <div className="border-destructive/40 bg-destructive/5 flex shrink-0 items-start gap-2.5 border-b px-4 py-2.5">
          <CircleAlert className="text-destructive mt-0.5 size-4 shrink-0" />
          <p className="text-muted-foreground text-xs leading-relaxed">{run.error}</p>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
          {live ? (
            <div className="bg-card/80 space-y-2 rounded-lg border p-4">
              <div className="flex items-center justify-between text-xs">
                <p className="text-neon-cyan flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin" />
                  Benchmarking — one request at a time so timings stay honest…
                </p>
                <p className="text-muted-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {summary.completed} / {summary.total} tasks
                </p>
              </div>
              <div className="bg-neon-cyan/15 h-2 w-full overflow-hidden rounded-full">
                <div
                  className="bg-neon-cyan h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
          ) : null}

          {summary.completed > 0 ? (
            <>
              <section className="space-y-2">
                <h2 className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
                  <span className="bg-neon-cyan mr-2 inline-block h-2.5 w-0.5 align-[-1px]" />
                  Leaderboard
                </h2>
                <ol className="space-y-1.5">
                  {leaderboard.map((entry, rank) => (
                    <li
                      key={entry.model}
                      className={cn(
                        "bg-card/80 flex items-center gap-3 rounded-lg border px-4 py-3",
                        rank === 0 && run.status === "done" && "box-glow-cyan",
                      )}
                    >
                      <span className="text-muted-foreground w-5 text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {rank + 1}
                      </span>
                      {rank === 0 && run.status === "done" ? (
                        <Trophy className="text-neon-yellow size-4 shrink-0" />
                      ) : (
                        <span
                          className="inline-block size-2.5 shrink-0 rounded-full"
                          style={{ background: entry.color }}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-sm" title={entry.model}>
                          {entry.label}
                        </p>
                        <div className="bg-muted mt-1.5 h-1.5 w-full max-w-72 overflow-hidden rounded-full">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${entry.score * 100}%`, background: entry.color }}
                          />
                        </div>
                      </div>
                      <div className="flex shrink-0 items-baseline gap-4 text-right">
                        <p className="w-14 text-lg font-semibold tracking-tight">
                          {entry.scoredCompleted > 0 ? `${Math.round(entry.score * 100)}%` : "—"}
                        </p>
                        <p className="text-muted-foreground hidden w-16 text-xs sm:block">
                          {entry.scoredCompleted > 0
                            ? `${entry.passed}/${entry.scoredCompleted} passed`
                            : `${entry.completed} timed`}
                        </p>
                        <p className="text-muted-foreground hidden w-14 text-xs md:block">
                          {entry.avgLatencyMs !== null
                            ? `${(entry.avgLatencyMs / 1000).toFixed(1)}s avg`
                            : "—"}
                        </p>
                        <p className="text-muted-foreground hidden w-18 text-xs xl:block">
                          {entry.avgTtftMs !== null
                            ? `${(entry.avgTtftMs / 1000).toFixed(2)}s TTFT`
                            : "—"}
                        </p>
                        <p className="text-muted-foreground hidden w-16 text-xs lg:block">
                          {entry.avgTokensPerSecond !== null
                            ? `${entry.avgTokensPerSecond.toFixed(1)} tok/s`
                            : "—"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>

              {hasScored ? (
                <section className="space-y-2">
                  <h2 className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
                    <span className="bg-neon-cyan mr-2 inline-block h-2.5 w-0.5 align-[-1px]" />
                    Accuracy
                  </h2>
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <ChartCard title="Overall accuracy">
                      <BarChart
                        title="Overall accuracy"
                        categories={labels}
                        series={[
                          {
                            name: "Score",
                            data: summary.models.map((m) => Math.round(m.score * 1000) / 10),
                          },
                        ]}
                        unit="%"
                        categoryColors={modelColors}
                      />
                    </ChartCard>

                    {summary.categories.length > 1 ? (
                      <ChartCard
                        title="Accuracy by category"
                        legend={labels.map((name, i) => ({ name, color: modelColors[i] }))}
                      >
                        <BarChart
                          title="Accuracy by category"
                          categories={summary.categories.map((c) => c.category)}
                          series={summary.models.map((m, mi) => ({
                            name: m.label,
                            data: summary.categories.map((c) =>
                              c.scores[mi] === null ? 0 : Math.round(c.scores[mi]! * 10) / 10,
                            ),
                          }))}
                          unit="%"
                        />
                      </ChartCard>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <PerformancePanel summary={summary} colors={modelColors} />

              <section className="space-y-2">
                <h2 className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
                  <span className="bg-neon-cyan mr-2 inline-block h-2.5 w-0.5 align-[-1px]" />
                  Cost estimate
                  <span className="text-muted-foreground/70 ml-2 normal-case">
                    (self-reported, not metered)
                  </span>
                </h2>
                <CostPanel
                  models={summary.models.map((m, mi) => ({
                    label: m.label,
                    model: m.model,
                    color: modelColors[mi],
                    local: m.provider === "local" || m.provider === "ollama",
                    totalLatencyMs: m.totalLatencyMs,
                    totalPromptTokens: m.totalPromptTokens,
                    totalOutputTokens: m.totalOutputTokens,
                    avgTokensPerSecond: m.avgTokensPerSecond,
                  }))}
                  rate={cost?.perHour ?? null}
                  rateSource={cost?.source ?? null}
                  wallClockMs={wallClockMs}
                  pricing={pricing}
                />
              </section>

              <section className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
                    <span className="bg-neon-cyan mr-2 inline-block h-2.5 w-0.5 align-[-1px]" />
                    Task results
                    <span className="text-muted-foreground/70 ml-2 normal-case">
                      (click a row to inspect outputs)
                    </span>
                  </h2>
                  <div className="ml-auto flex items-center gap-2">
                    <Select
                      value={categoryFilter}
                      onValueChange={(v) => v && setCategoryFilter(v)}
                    >
                      <SelectTrigger size="sm" className="w-36" aria-label="Filter by category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All categories</SelectItem>
                        {taskCategories.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={outcomeFilter}
                      onValueChange={(v) =>
                        v && setOutcomeFilter(v as "all" | "passed" | "failed")
                      }
                    >
                      <SelectTrigger size="sm" className="w-28" aria-label="Filter by outcome">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All tasks</SelectItem>
                        <SelectItem value="passed">Passed</SelectItem>
                        <SelectItem value="failed">Failed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="bg-card/80 overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="px-3 py-2 text-left">
                          <button
                            type="button"
                            onClick={() => toggleTaskSort("task")}
                            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium transition-colors"
                          >
                            Task {sortIcon("task")}
                          </button>
                        </th>
                        <th className="px-2 py-2 text-left">
                          <button
                            type="button"
                            onClick={() => toggleTaskSort("category")}
                            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium transition-colors"
                          >
                            Category {sortIcon("category")}
                          </button>
                        </th>
                        {summary.models.map((m, mi) => (
                          <th
                            key={m.model}
                            className="max-w-28 truncate px-2 py-2 text-center"
                            title={`${m.model} — click to sort by score`}
                          >
                            <button
                              type="button"
                              onClick={() => toggleTaskSort(mi)}
                              className="text-muted-foreground hover:text-foreground inline-flex max-w-full items-center gap-1 text-xs font-medium transition-colors"
                            >
                              <span
                                className="inline-block size-2 shrink-0 rounded-full"
                                style={{ background: modelColors[mi] }}
                              />
                              <span className="truncate">{m.label}</span>
                              {sortIcon(mi)}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleTasks.map((task) => (
                        <Fragment key={task.index}>
                          <tr
                            className={cn(
                              "border-border/50 hover:bg-accent/30 cursor-pointer border-b transition-colors last:border-0",
                              openTask === task.index && "bg-accent/20",
                            )}
                            onClick={() =>
                              setOpenTask(openTask === task.index ? null : task.index)
                            }
                          >
                            <td className="px-3 py-2">{task.name}</td>
                            <td className="text-muted-foreground px-2 py-2 text-xs">
                              {task.category}
                            </td>
                            {task.cells.map((cell, mi) => (
                              <td key={mi} className="px-2 py-2 text-center">
                                <CellMark cell={cell} scoring={task.scoring} />
                              </td>
                            ))}
                          </tr>
                          {openTask === task.index ? (
                            <tr className="border-border/50 border-b">
                              <td colSpan={2 + summary.models.length} className="px-4 py-3">
                                <div className="space-y-3">
                                  <div className="text-xs">
                                    <p className="text-muted-foreground mb-1 font-medium">
                                      Prompt
                                    </p>
                                    <p className="whitespace-pre-wrap">{task.prompt}</p>
                                    {task.expected ? (
                                      <p className="text-muted-foreground mt-1.5">
                                        Expected ({task.scoring}):{" "}
                                        <span className="text-neon-green font-mono">
                                          {task.expected}
                                        </span>
                                      </p>
                                    ) : null}
                                  </div>
                                  <div className="grid gap-2 lg:grid-cols-2">
                                    {task.cells.map((cell, mi) =>
                                      cell ? (
                                        <div
                                          key={mi}
                                          className="bg-background/60 rounded border p-2.5"
                                        >
                                          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                                            <span
                                              className="inline-block size-2 rounded-full"
                                              style={{ background: modelColors[mi] }}
                                            />
                                            {summary.models[mi].label}
                                            <span className="text-muted-foreground font-normal">
                                              — {(cell.latencyMs / 1000).toFixed(1)}s
                                              {cell.ttftMs
                                                ? `, TTFT ${(cell.ttftMs / 1000).toFixed(2)}s`
                                                : ""}
                                              {cell.tokensPerSecond
                                                ? `, ${cell.tokensPerSecond.toFixed(1)} tok/s`
                                                : ""}
                                              {cell.prefillTokensPerSecond
                                                ? `, prefill ${Math.round(cell.prefillTokensPerSecond)} tok/s`
                                                : ""}
                                              {cell.phases
                                                ? ` · prefill ${Math.round(cell.phases.prefill)}ms, decode ${Math.round(cell.phases.decode)}ms`
                                                : ""}
                                            </span>
                                          </p>
                                          {cell.error ? (
                                            <p className="text-neon-yellow mb-1 text-xs">
                                              {cell.error}
                                            </p>
                                          ) : null}
                                          <pre className="text-muted-foreground max-h-48 overflow-y-auto text-xs whitespace-pre-wrap">
                                            {cell.output || "(no output)"}
                                          </pre>
                                        </div>
                                      ) : null,
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      ))}
                      {visibleTasks.length === 0 ? (
                        <tr>
                          <td
                            colSpan={2 + summary.models.length}
                            className="text-muted-foreground px-3 py-6 text-center text-xs"
                          >
                            No tasks match the current filters.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : !live ? (
            <p className="text-muted-foreground py-10 text-center text-sm">
              No results were recorded for this run.
            </p>
          ) : (
            <p className="text-muted-foreground py-10 text-center text-sm">
              Waiting for the first result…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
