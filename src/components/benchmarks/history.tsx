"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChartLine } from "lucide-react";

import { cn } from "@/lib/utils";
import { ChartLegend, LineChart, seriesColor } from "@/components/dashboards/charts";
import { modelLabels, type HistoryEntry } from "@/lib/benchmark-score";
import { formatUsd } from "@/lib/benchmark-cost";
import { Dumbbell, type RangeRow } from "./charts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SortKey =
  | "date"
  | "run"
  | "suite"
  | "model"
  | "score"
  | "ttft"
  | "prefill"
  | "tps"
  | "tpot"
  | "p95"
  | "cost";

/** Numeric-first columns open descending (best/newest on top); text columns ascending. */
const DEFAULT_DESC: SortKey[] = ["date", "score", "tps", "cost"];

/** A metric that can be trended across runs. */
interface TrendMetric {
  key: string;
  label: string;
  unit: string;
  /** True when a drop between runs is an improvement. */
  lowerIsBetter: boolean;
  pick: (entry: HistoryEntry) => number | null;
}

const round = (value: number, places = 1): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const TREND_METRICS: TrendMetric[] = [
  {
    key: "score",
    label: "Accuracy",
    unit: "%",
    lowerIsBetter: false,
    pick: (e) => (e.score !== null ? round(e.score * 100) : null),
  },
  {
    key: "tps",
    label: "Decode speed",
    unit: "tok/s",
    lowerIsBetter: false,
    pick: (e) => (e.avgTokensPerSecond !== null ? round(e.avgTokensPerSecond) : null),
  },
  {
    key: "prefillTps",
    label: "Prefill throughput",
    unit: "tok/s",
    lowerIsBetter: false,
    pick: (e) =>
      e.avgPrefillTokensPerSecond !== null ? round(e.avgPrefillTokensPerSecond) : null,
  },
  {
    key: "ttft",
    label: "Time to first token",
    unit: "ms",
    lowerIsBetter: true,
    pick: (e) => (e.avgTtftMs !== null ? round(e.avgTtftMs, 0) : null),
  },
  {
    key: "prefill",
    label: "Prefill time",
    unit: "ms",
    lowerIsBetter: true,
    pick: (e) => (e.phases !== null ? round(e.phases.prefill, 0) : null),
  },
  {
    key: "decode",
    label: "Decode time",
    unit: "ms",
    lowerIsBetter: true,
    pick: (e) => (e.phases !== null ? round(e.phases.decode, 0) : null),
  },
  {
    key: "tpot",
    label: "Time per output token",
    unit: "ms",
    lowerIsBetter: true,
    pick: (e) => (e.avgTpotMs !== null ? round(e.avgTpotMs, 2) : null),
  },
  {
    key: "latency",
    label: "Response time (mean)",
    unit: "ms",
    lowerIsBetter: true,
    pick: (e) => (e.avgLatencyMs !== null ? round(e.avgLatencyMs, 0) : null),
  },
  {
    key: "p95",
    label: "Response time (p95)",
    unit: "ms",
    lowerIsBetter: true,
    pick: (e) => (e.p95LatencyMs !== null ? round(e.p95LatencyMs, 0) : null),
  },
  {
    key: "cv",
    label: "Response spread",
    unit: "%",
    lowerIsBetter: true,
    pick: (e) => (e.latencyCv !== null ? round(e.latencyCv * 100) : null),
  },
  {
    key: "cost",
    label: "Estimated cost",
    unit: "$",
    lowerIsBetter: true,
    pick: (e) => (e.estimatedCost !== null ? round(e.estimatedCost, 4) : null),
  },
];

function parseDbDate(value: string): Date {
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

const shortDate = (value: string) =>
  parseDbDate(value).toLocaleDateString("en", { month: "short", day: "numeric" });

const shortDateTime = (value: string) =>
  parseDbDate(value).toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function sortValue(entry: HistoryEntry, key: SortKey): string | number {
  switch (key) {
    case "date":
      return entry.createdAt;
    case "run":
      return entry.runTitle.toLowerCase();
    case "suite":
      return entry.suiteName.toLowerCase();
    case "model":
      return entry.model.toLowerCase();
    case "score":
      return entry.score ?? -1;
    case "ttft":
      return entry.avgTtftMs ?? -1;
    case "prefill":
      return entry.phases?.prefill ?? -1;
    case "tps":
      return entry.avgTokensPerSecond ?? -1;
    case "tpot":
      return entry.avgTpotMs ?? -1;
    case "p95":
      return entry.p95LatencyMs ?? -1;
    case "cost":
      return entry.estimatedCost ?? -1;
  }
}

function SortHeader({
  label,
  k,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  return (
    <th className={cn("px-2 py-2", align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium transition-colors",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
        {active ? (
          sort.dir === 1 ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : null}
      </button>
    </th>
  );
}

interface RunRef {
  id: string;
  label: string;
}

/**
 * Runs (x-axis) × models (series). A gap must never be plotted as a zero, so
 * something has to give when a model is missing from a run — and it is the
 * *model* that gets dropped, not the run. Dropping runs instead empties the
 * chart as soon as one run compared a different set of models, which is the
 * normal case: nightly runs over three models plus an occasional five-model
 * shootout should still trend the three they share.
 */
function buildChart(
  runs: RunRef[],
  models: string[],
  labelOf: (model: string) => string,
  value: (runId: string, model: string) => number | null,
): { categories: string[]; series: { name: string; data: number[] }[] } | null {
  if (models.length === 0) return null;

  // Runs that measured this metric at all. The rest aren't gaps, they're N/A —
  // a timing-only run has no accuracy to plot and must not break the line.
  const withData = runs.filter((run) => models.some((m) => value(run.id, m) !== null));

  let series = models.filter((m) => withData.every((run) => value(run.id, m) !== null));
  let usable = withData;

  if (series.length === 0) {
    // Nothing spans every run — fall back to the best-covered model alone, over
    // just the runs where it has a value.
    const best = models
      .map((m) => ({ model: m, runs: withData.filter((run) => value(run.id, m) !== null) }))
      .sort((a, b) => b.runs.length - a.runs.length)[0];
    if (!best || best.runs.length < 2) return null;
    series = [best.model];
    usable = best.runs;
  }

  if (usable.length < 2) return null;
  return {
    categories: usable.map((run) => run.label),
    series: series.map((m) => ({
      name: labelOf(m),
      data: usable.map((run) => value(run.id, m)!),
    })),
  };
}

function ChartCard({
  title,
  hint,
  legend,
  children,
}: {
  title: string;
  hint?: string;
  legend?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card/80 min-w-0 rounded-lg border p-4">
      <div className="mb-3 space-y-1.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {hint ? (
          <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p>
        ) : null}
        {legend}
      </div>
      {children}
    </div>
  );
}

const numeric = { fontVariantNumeric: "tabular-nums" } as const;

export function BenchmarkHistory({ entries }: { entries: HistoryEntry[] }) {
  const router = useRouter();
  const [suiteFilter, setSuiteFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [metricKey, setMetricKey] = useState(TREND_METRICS[0].key);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "date",
    dir: -1,
  });

  if (entries.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center text-sm">
        <ChartLine className="size-6" />
        <p>No results yet — finish a benchmark run and it shows up here.</p>
      </div>
    );
  }

  const suites = [...new Set(entries.map((e) => e.suiteName))];
  const allModels = [...new Set(entries.map((e) => e.model))];
  const allLabels = modelLabels(allModels);
  const labelOf = (model: string) => allLabels[allModels.indexOf(model)] ?? model;
  const metric = TREND_METRICS.find((m) => m.key === metricKey) ?? TREND_METRICS[0];

  // Suite filter scopes both the charts and the table; entries arrive oldest first.
  const scope = entries.filter(
    (e) => suiteFilter === "all" || e.suiteName === suiteFilter,
  );

  const runs: RunRef[] = [];
  for (const e of scope) {
    if (!runs.some((r) => r.id === e.runId))
      runs.push({ id: e.runId, label: shortDate(e.createdAt) });
  }
  const byRunModel = new Map(scope.map((e) => [`${e.runId}|${e.model}`, e]));
  const valueOf =
    (pick: (e: HistoryEntry) => number | null) => (runId: string, model: string) => {
      const e = byRunModel.get(`${runId}|${model}`);
      return e ? pick(e) : null;
    };

  const chartModels =
    modelFilter === "all"
      ? [...new Set(scope.map((e) => e.model))]
          .sort(
            (a, b) =>
              scope.filter((e) => e.model === b).length -
              scope.filter((e) => e.model === a).length,
          )
          .slice(0, 5)
      : [modelFilter];

  const trend = buildChart(runs, chartModels, labelOf, valueOf(metric.pick));

  // Latest run against the one before it, for the models that appear in both —
  // the "did this change make things worse?" read.
  const [previousRun, latestRun] = runs.slice(-2);
  const deltaRows: RangeRow[] = [];
  if (previousRun && latestRun) {
    for (const model of chartModels) {
      const from = valueOf(metric.pick)(previousRun.id, model);
      const to = valueOf(metric.pick)(latestRun.id, model);
      if (from === null || to === null) continue;
      deltaRows.push({
        label: labelOf(model),
        color: seriesColor(chartModels.indexOf(model)),
        from,
        to,
      });
    }
  }

  const rows = scope
    .filter((e) => modelFilter === "all" || e.model === modelFilter)
    .sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });

  function onSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 1 ? -1 : 1 }
        : { key, dir: DEFAULT_DESC.includes(key) ? -1 : 1 },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={suiteFilter} onValueChange={(v) => v && setSuiteFilter(v)}>
          <SelectTrigger size="sm" className="w-44" aria-label="Filter by suite">
            <SelectValue>{(v: string) => (v === "all" ? "All suites" : v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All suites</SelectItem>
            {suites.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={modelFilter} onValueChange={(v) => v && setModelFilter(v)}>
          <SelectTrigger size="sm" className="w-44" aria-label="Filter by model">
            <SelectValue>{(v: string) => (v === "all" ? "All models" : labelOf(v))}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All models</SelectItem>
            {allModels.map((model) => (
              <SelectItem key={model} value={model}>
                {labelOf(model)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={metricKey} onValueChange={(v) => v && setMetricKey(v)}>
          <SelectTrigger size="sm" className="w-52" aria-label="Trend metric">
            <SelectValue>
              {(v: string) => TREND_METRICS.find((m) => m.key === v)?.label ?? v}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TREND_METRICS.map((m) => (
              <SelectItem key={m.key} value={m.key}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground ml-auto text-xs">
          {rows.length} result{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      {trend ? (
        <ChartCard
          title={`${metric.label} over time`}
          hint={`One point per run, oldest first. ${
            metric.lowerIsBetter ? "Lower is better." : "Higher is better."
          } Runs where a model has no measurement are skipped rather than plotted as zero.`}
          legend={
            <ChartLegend
              series={trend.series.map((s, i) => ({
                name: s.name,
                color: seriesColor(i),
              }))}
            />
          }
        >
          <LineChart
            title={`${metric.label} over time`}
            categories={trend.categories}
            series={trend.series}
            unit={metric.unit}
          />
        </ChartCard>
      ) : (
        <p className="text-muted-foreground text-xs">
          Trend charts appear once at least two runs
          {suiteFilter === "all" ? "" : " in this suite"} share a model with a{" "}
          {metric.label.toLowerCase()} measurement.
        </p>
      )}

      {deltaRows.length > 0 ? (
        <ChartCard
          title={`Last run against the one before`}
          hint={`Faded dot is the previous run, solid dot the latest. ${
            metric.lowerIsBetter
              ? "A dot that moved left is an improvement."
              : "A dot that moved right is an improvement."
          }`}
        >
          <Dumbbell
            rows={deltaRows}
            title={`${metric.label}: previous run to latest`}
            unit={metric.unit}
            fromLabel="previous"
            toLabel="latest"
          />
        </ChartCard>
      ) : null}

      <div className="bg-card/80 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <SortHeader label="Date" k="date" sort={sort} onSort={onSort} />
              <SortHeader label="Run" k="run" sort={sort} onSort={onSort} />
              <SortHeader label="Suite" k="suite" sort={sort} onSort={onSort} />
              <SortHeader label="Model" k="model" sort={sort} onSort={onSort} />
              <SortHeader
                label="Score"
                k="score"
                sort={sort}
                onSort={onSort}
                align="right"
              />
              <SortHeader
                label="TTFT"
                k="ttft"
                sort={sort}
                onSort={onSort}
                align="right"
              />
              <SortHeader
                label="Prefill"
                k="prefill"
                sort={sort}
                onSort={onSort}
                align="right"
              />
              <SortHeader
                label="Tok/s"
                k="tps"
                sort={sort}
                onSort={onSort}
                align="right"
              />
              <SortHeader
                label="TPOT"
                k="tpot"
                sort={sort}
                onSort={onSort}
                align="right"
              />
              <SortHeader label="p95" k="p95" sort={sort} onSort={onSort} align="right" />
              <SortHeader
                label="~Cost"
                k="cost"
                sort={sort}
                onSort={onSort}
                align="right"
              />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr
                key={`${e.runId}:${e.model}`}
                onClick={() => router.push(`/benchmarks?r=${e.runId}`)}
                className="border-border/50 hover:bg-accent/30 cursor-pointer border-b text-xs transition-colors last:border-0"
              >
                <td className="text-muted-foreground px-2 py-2 whitespace-nowrap">
                  {shortDateTime(e.createdAt)}
                </td>
                <td className="max-w-40 truncate px-2 py-2" title={e.runTitle}>
                  {e.runTitle}
                  {e.status !== "done" ? (
                    <span className="text-muted-foreground"> ({e.status})</span>
                  ) : null}
                </td>
                <td className="text-muted-foreground max-w-32 truncate px-2 py-2">
                  {e.suiteName}
                </td>
                <td className="max-w-40 truncate px-2 py-2 font-mono" title={e.model}>
                  {labelOf(e.model)}
                </td>
                <td className="px-2 py-2 text-right" style={numeric}>
                  {e.score !== null ? `${Math.round(e.score * 100)}%` : "—"}
                </td>
                <td
                  className="text-muted-foreground px-2 py-2 text-right"
                  style={numeric}
                >
                  {e.avgTtftMs !== null ? `${(e.avgTtftMs / 1000).toFixed(2)}s` : "—"}
                </td>
                <td
                  className="text-muted-foreground px-2 py-2 text-right"
                  style={numeric}
                >
                  {e.phases !== null ? `${Math.round(e.phases.prefill)}ms` : "—"}
                </td>
                <td
                  className="text-muted-foreground px-2 py-2 text-right"
                  style={numeric}
                >
                  {e.avgTokensPerSecond !== null ? e.avgTokensPerSecond.toFixed(1) : "—"}
                </td>
                <td
                  className="text-muted-foreground px-2 py-2 text-right"
                  style={numeric}
                >
                  {e.avgTpotMs !== null ? `${e.avgTpotMs.toFixed(1)}ms` : "—"}
                </td>
                <td
                  className="text-muted-foreground px-2 py-2 text-right"
                  style={numeric}
                >
                  {e.p95LatencyMs !== null
                    ? `${(e.p95LatencyMs / 1000).toFixed(2)}s`
                    : "—"}
                </td>
                <td
                  className="text-muted-foreground px-2 py-2 text-right"
                  style={numeric}
                >
                  {e.estimatedCost !== null ? `~${formatUsd(e.estimatedCost)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-xs">
        TTFT is time to first token, TPOT is time per output token, p95 is the tail
        response time across a run&apos;s tasks. Cost figures are self-reported estimates
        (time × your $/hr rate), not metered billing.
      </p>
    </div>
  );
}
