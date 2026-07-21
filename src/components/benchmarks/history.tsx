"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChartLine } from "lucide-react";

import { cn } from "@/lib/utils";
import { ChartLegend, LineChart, seriesColor } from "@/components/dashboards/charts";
import { modelLabels, type HistoryEntry } from "@/lib/benchmark-score";
import { formatUsd } from "@/lib/benchmark-cost";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SortKey = "date" | "run" | "suite" | "model" | "score" | "ttft" | "tps" | "cost";

/** Numeric-first columns open descending (best/newest on top); text columns ascending. */
const DEFAULT_DESC: SortKey[] = ["date", "score", "tps", "cost"];

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
    case "tps":
      return entry.avgTokensPerSecond ?? -1;
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

/** Runs (x-axis) × models (series); drops runs missing any series so gaps never plot as 0. */
function buildChart(
  runs: RunRef[],
  models: string[],
  labelOf: (model: string) => string,
  value: (runId: string, model: string) => number | null,
): { categories: string[]; series: { name: string; data: number[] }[] } | null {
  if (models.length === 0) return null;
  const usable = runs.filter((run) => models.every((m) => value(run.id, m) !== null));
  if (usable.length < 2) return null;
  return {
    categories: usable.map((run) => run.label),
    series: models.map((m) => ({
      name: labelOf(m),
      data: usable.map((run) => value(run.id, m)!),
    })),
  };
}

function HistoryChartCard({
  title,
  chart,
  unit,
}: {
  title: string;
  chart: { categories: string[]; series: { name: string; data: number[] }[] };
  unit: string;
}) {
  return (
    <div className="bg-card/80 min-w-0 rounded-lg border p-4">
      <div className="mb-3 space-y-1.5">
        <h3 className="text-sm font-medium">{title}</h3>
        <ChartLegend
          series={chart.series.map((s, i) => ({ name: s.name, color: seriesColor(i) }))}
        />
      </div>
      <LineChart title={title} categories={chart.categories} series={chart.series} unit={unit} />
    </div>
  );
}

export function BenchmarkHistory({ entries }: { entries: HistoryEntry[] }) {
  const router = useRouter();
  const [suiteFilter, setSuiteFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "date", dir: -1 });

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

  // Suite filter scopes both the charts and the table; entries arrive oldest first.
  const scope = entries.filter((e) => suiteFilter === "all" || e.suiteName === suiteFilter);

  const runs: RunRef[] = [];
  for (const e of scope) {
    if (!runs.some((r) => r.id === e.runId)) runs.push({ id: e.runId, label: shortDate(e.createdAt) });
  }
  const byRunModel = new Map(scope.map((e) => [`${e.runId}|${e.model}`, e]));
  const metric = (pick: (e: HistoryEntry) => number | null) => (runId: string, model: string) => {
    const e = byRunModel.get(`${runId}|${model}`);
    if (!e) return null;
    return pick(e);
  };

  const chartModels =
    modelFilter === "all"
      ? [...new Set(scope.map((e) => e.model))]
          .sort(
            (a, b) =>
              scope.filter((e) => e.model === b).length - scope.filter((e) => e.model === a).length,
          )
          .slice(0, 5)
      : [modelFilter];

  const scoreChart = buildChart(runs, chartModels, labelOf, metric((e) =>
    e.score !== null ? Math.round(e.score * 1000) / 10 : null,
  ));
  const speedChart = buildChart(runs, chartModels, labelOf, metric((e) =>
    e.avgTokensPerSecond !== null ? Math.round(e.avgTokensPerSecond * 10) / 10 : null,
  ));

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
          <SelectTrigger size="sm" className="w-48" aria-label="Filter by suite">
            <SelectValue />
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
          <SelectTrigger size="sm" className="w-48" aria-label="Filter by model">
            <SelectValue />
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
        <p className="text-muted-foreground ml-auto text-xs">
          {rows.length} result{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      {scoreChart || speedChart ? (
        <div className="grid grid-cols-1 gap-3">
          {scoreChart ? (
            <HistoryChartCard title="Accuracy over time" chart={scoreChart} unit="%" />
          ) : null}
          {speedChart ? (
            <HistoryChartCard title="Generation speed over time" chart={speedChart} unit="tok/s" />
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          Trend charts appear once at least two runs share a comparable model
          {suiteFilter === "all" ? "" : " in this suite"}.
        </p>
      )}

      <div className="bg-card/80 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <SortHeader label="Date" k="date" sort={sort} onSort={onSort} />
              <SortHeader label="Run" k="run" sort={sort} onSort={onSort} />
              <SortHeader label="Suite" k="suite" sort={sort} onSort={onSort} />
              <SortHeader label="Model" k="model" sort={sort} onSort={onSort} />
              <SortHeader label="Score" k="score" sort={sort} onSort={onSort} align="right" />
              <SortHeader label="TTFT" k="ttft" sort={sort} onSort={onSort} align="right" />
              <SortHeader label="Tok/s" k="tps" sort={sort} onSort={onSort} align="right" />
              <SortHeader label="~Cost" k="cost" sort={sort} onSort={onSort} align="right" />
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
                <td className="text-muted-foreground max-w-32 truncate px-2 py-2">{e.suiteName}</td>
                <td className="max-w-40 truncate px-2 py-2 font-mono" title={e.model}>
                  {labelOf(e.model)}
                </td>
                <td className="px-2 py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {e.score !== null ? `${Math.round(e.score * 100)}%` : "—"}
                </td>
                <td
                  className="text-muted-foreground px-2 py-2 text-right"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {e.avgTtftMs !== null ? `${(e.avgTtftMs / 1000).toFixed(2)}s` : "—"}
                </td>
                <td
                  className="text-muted-foreground px-2 py-2 text-right"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {e.avgTokensPerSecond !== null ? e.avgTokensPerSecond.toFixed(1) : "—"}
                </td>
                <td
                  className="text-muted-foreground px-2 py-2 text-right"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {e.estimatedCost !== null ? `~${formatUsd(e.estimatedCost)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-xs">
        Cost figures are self-reported estimates (time × your $/hr rate), not metered billing.
      </p>
    </div>
  );
}
