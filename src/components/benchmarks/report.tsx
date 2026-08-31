"use client";

import { formatValue, seriesColor } from "@/components/dashboards/charts";
import { costOfMs, estimateCost, formatUsd, type TokenPrice } from "@/lib/benchmark-cost";
import {
  buildVerdicts,
  isTimingOnly,
  PHASE_KEYS,
  PHASE_LABELS,
  type ModelSummary,
  type RunSummaryView,
} from "@/lib/benchmark-score";
import type { ReportSection } from "@/lib/report";
import {
  BoxPlot,
  Heatmap,
  PAPER_PALETTE,
  PhaseBreakdown,
  PhaseLegend,
  type BoxRow,
  type HeatCell,
  type PhaseRow,
} from "./charts";

/**
 * The printable benchmark report. Rendered on the light `.report-paper`
 * surface — the chart kit reads its greys from theme tokens, so overriding
 * those on the wrapper is enough to move the whole thing onto paper; only the
 * ordinal ramps are swapped explicitly, via `PAPER_PALETTE`.
 *
 * Width is fixed rather than fluid so the on-screen preview and the printed
 * page lay out identically (A4 minus 14 mm margins ≈ 182 mm ≈ 688 px at 96 dpi).
 */
export const REPORT_WIDTH = 688;

export interface ReportRun {
  id: string;
  title: string;
  suiteName: string;
  status: string;
  createdAt: string;
  temperature: number;
  startedAt: string | null;
  finishedAt: string | null;
}

function parseDbDate(value: string): Date {
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

function formatStamp(value: string): string {
  return parseDbDate(value).toLocaleString("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const ms = (value: number | null): string =>
  value === null ? "—" : formatValue(value, "ms");
const tps = (value: number | null): string =>
  value === null ? "—" : formatValue(value, "tok/s");

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="report-block mt-6 first:mt-0">
      <h2 className="border-border mb-1 border-b pb-1 text-[13px] font-semibold tracking-wide">
        {title}
      </h2>
      {note ? <p className="text-muted-foreground mb-2 text-[10px]">{note}</p> : null}
      {children}
    </section>
  );
}

function Table({
  head,
  rows,
}: {
  head: string[];
  /** Cell 0 of each row is left-aligned; the rest are numeric and right-aligned. */
  rows: React.ReactNode[][];
}) {
  return (
    <table className="w-full border-collapse text-[10px]">
      <thead>
        <tr className="border-border border-b">
          {head.map((h, i) => (
            <th
              key={h}
              className={`text-muted-foreground py-1 font-medium ${
                i === 0 ? "pr-2 text-left" : "px-1.5 text-right"
              }`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} className="border-border/60 report-block border-b last:border-0">
            {row.map((cell, ci) => (
              <td
                key={ci}
                className={`py-1 ${ci === 0 ? "pr-2" : "px-1.5 text-right"}`}
                style={ci === 0 ? undefined : { fontVariantNumeric: "tabular-nums" }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block size-2 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function BenchmarkReport({
  run,
  summary,
  sections,
  costPerHour,
  pricing,
  generatedAt,
}: {
  run: ReportRun;
  summary: RunSummaryView;
  sections: ReportSection[];
  /** Effective $/hour for this run; null when no rate was configured. */
  costPerHour: number | null;
  /** Per-token rates for metered providers. */
  pricing: TokenPrice[];
  /** ISO timestamp stamped into the footer, resolved on the server. */
  generatedAt: string;
}) {
  const models = summary.models;
  const colors = models.map((_, i) => seriesColor(i));
  const has = (key: ReportSection) => sections.includes(key);

  const verdicts = buildVerdicts(summary);
  const ranked = verdicts.ranked.map((i) => models[i]);
  const hasScored = models.some((m) => m.scoredCompleted > 0);
  const colorOf = (m: ModelSummary) => colors[models.indexOf(m)];

  const wallClockMs =
    run.startedAt && run.finishedAt
      ? Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt))
      : null;

  const phaseRows: PhaseRow[] = models
    .filter((m) => m.phases !== null)
    .map((m) => ({ label: m.label, color: colorOf(m), phases: m.phases! }));

  const latencyRows: BoxRow[] = models
    .filter((m) => m.latency !== null && m.latency.count > 1)
    .map((m) => ({ label: m.label, color: colorOf(m), stats: m.latency! }));

  const ttftRows: BoxRow[] = models
    .filter((m) => m.ttft !== null && m.ttft.count > 1)
    .map((m) => ({ label: m.label, color: colorOf(m), stats: m.ttft! }));

  const heatCells: HeatCell[][] = summary.tasks.map((task) =>
    models.map((_, mi) => {
      const cell = task.cells[mi];
      const value = cell?.latencyMs ?? null;
      return {
        value: value && value > 0 ? value : null,
        text: value && value > 0 ? formatValue(value, "ms") : "—",
      };
    }),
  );

  return (
    <article
      className="report-paper mx-auto px-1 pb-8 text-[11px] leading-relaxed"
      style={{ width: REPORT_WIDTH }}
    >
      <header className="report-block border-border mb-5 border-b pb-3">
        <p className="text-muted-foreground text-[10px] tracking-widest uppercase">
          Loom · benchmark report
        </p>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">{run.title}</h1>
        <dl className="text-muted-foreground mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[10px]">
          <div className="flex gap-1.5">
            <dt className="font-medium">Suite</dt>
            <dd>{run.suiteName || "—"}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="font-medium">Run</dt>
            <dd>{formatStamp(run.createdAt)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="font-medium">Models</dt>
            <dd>{models.length}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="font-medium">Tasks</dt>
            <dd>
              {summary.tasks.length} ({summary.completed}/{summary.total} cells)
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="font-medium">Status</dt>
            <dd>{run.status}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="font-medium">Temperature</dt>
            <dd>{run.temperature === 0 ? "0 (greedy)" : run.temperature}</dd>
          </div>
          {wallClockMs !== null ? (
            <div className="flex gap-1.5">
              <dt className="font-medium">Wall clock</dt>
              <dd>{formatDuration(wallClockMs)}</dd>
            </div>
          ) : null}
        </dl>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
          {models.map((m, i) => (
            <li key={m.model} className="max-w-56">
              <Swatch color={colors[i]} label={m.model} />
            </li>
          ))}
        </ul>
      </header>

      {has("leaderboard") ? (
        <Section
          title="Leaderboard"
          note={
            hasScored
              ? "Ranked by mean score across the suite's scored tasks; timing-only probes are excluded from accuracy."
              : "This run had no scored tasks — timing probes only."
          }
        >
          <Table
            head={["Model", "Score", "Passed", "Avg", "TTFT", "Decode"]}
            rows={ranked.map((m, rank) => [
              <Swatch key="m" color={colorOf(m)} label={`${rank + 1}. ${m.label}`} />,
              m.scoredCompleted > 0 ? `${Math.round(m.score * 100)}%` : "—",
              m.scoredCompleted > 0
                ? `${m.passed}/${m.scoredCompleted}`
                : `${m.completed} timed`,
              ms(m.avgLatencyMs),
              ms(m.avgTtftMs),
              tps(m.avgTokensPerSecond),
            ])}
          />
          {hasScored && summary.categories.length > 0 ? (
            <div className="report-block mt-3">
              <p className="text-muted-foreground mb-1 text-[10px] font-medium">
                Accuracy by category (%)
              </p>
              <Table
                head={["Category", ...models.map((m) => m.label)]}
                rows={summary.categories.map((c) => [
                  c.category,
                  ...c.scores.map((v) => (v === null ? "—" : `${Math.round(v)}%`)),
                ])}
              />
            </div>
          ) : null}
        </Section>
      ) : null}

      {has("phases") && phaseRows.length > 0 ? (
        <Section
          title="Where the time goes"
          note="Mean milliseconds per phase of a request. The four phases add up to the response time."
        >
          <div className="mb-2">
            <PhaseLegend palette={PAPER_PALETTE} />
          </div>
          <PhaseBreakdown
            rows={phaseRows}
            title="Request phase breakdown"
            palette={PAPER_PALETTE}
          />
          <dl className="text-muted-foreground mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[9px]">
            {PHASE_KEYS.map((key) => (
              <div key={key} className="flex gap-1">
                <dt className="text-foreground shrink-0 font-medium">
                  {PHASE_LABELS[key]}
                </dt>
                <dd>
                  {key === "encode"
                    ? "request built and serialized"
                    : key === "queue"
                      ? "on the wire until the server answers"
                      : key === "prefill"
                        ? "prompt evaluated, up to the first token"
                        : "output generated"}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      {has("distribution") && latencyRows.length > 0 ? (
        <Section
          title="Response time spread"
          note="Box spans the middle half of the run's tasks, the rule is the median, the ringed dot is p95, whiskers reach the fastest and slowest task."
        >
          <BoxPlot rows={latencyRows} title="Response time distribution" unit="ms" />
          {ttftRows.length > 0 ? (
            <div className="report-block mt-3">
              <p className="text-muted-foreground mb-1 text-[10px] font-medium">
                Time to first token
              </p>
              <BoxPlot
                rows={ttftRows}
                title="Time to first token distribution"
                unit="ms"
              />
            </div>
          ) : null}
        </Section>
      ) : null}

      {has("throughput") ? (
        <Section
          title="Throughput"
          note="Decode speed is measured over decode time only; prefill throughput comes from each task's first turn, before any prefix cache helps."
        >
          <Table
            head={[
              "Model",
              "Decode",
              "Prefill",
              "TPOT",
              "ITL p50",
              "ITL p95",
              "Tokens out",
            ]}
            rows={models.map((m) => [
              <Swatch key="m" color={colorOf(m)} label={m.label} />,
              tps(m.avgTokensPerSecond),
              tps(m.avgPrefillTokensPerSecond),
              ms(m.avgTpotMs),
              m.interToken ? `${Math.round(m.interToken.p50)} ms` : "—",
              m.interToken ? `${Math.round(m.interToken.p95)} ms` : "—",
              m.totalOutputTokens?.toLocaleString("en") ?? "—",
            ])}
          />
        </Section>
      ) : null}

      {has("metrics") ? (
        <Section
          title="All metrics"
          note="Every measured value behind the charts above, one row per model. Cold start is the discarded warmup request, excluded from the other columns."
        >
          <Table
            head={[
              "Model",
              "p50",
              "p95",
              "Spread",
              "Encode",
              "Queue",
              "Prefill",
              "Decode",
              "Cold start",
            ]}
            rows={models.map((m) => [
              <Swatch key="m" color={colorOf(m)} label={m.label} />,
              ms(m.latency?.median ?? null),
              ms(m.latency?.p95 ?? null),
              m.latency && m.latency.count > 1
                ? `±${Math.round(m.latency.cv * 100)}%`
                : "—",
              ms(m.phases?.encode ?? null),
              ms(m.phases?.queue ?? null),
              ms(m.phases?.prefill ?? null),
              ms(m.phases?.decode ?? null),
              ms(m.coldStartMs),
            ])}
          />
        </Section>
      ) : null}

      {has("tasks") && summary.tasks.length > 0 ? (
        <Section
          title="Per-task results"
          note="Response time per task and model; ✓ / ✗ marks the scored outcome where a task has one."
        >
          <Heatmap
            rowLabels={summary.tasks.map((t) => t.name)}
            columnLabels={models.map((m) => m.label)}
            columnColors={colors}
            cells={heatCells}
            lowerIsBetter
            palette={PAPER_PALETTE}
          />
          <div className="report-block mt-3">
            <Table
              head={["Task", "Category", ...models.map((m) => m.label)]}
              rows={summary.tasks.map((task) => [
                task.name,
                task.category,
                ...task.cells.map((cell) => {
                  if (cell === null) return "—";
                  if (isTimingOnly(task.scoring)) return ms(cell.latencyMs);
                  return cell.passed ? "✓" : "✗";
                }),
              ])}
            />
          </div>
        </Section>
      ) : null}

      {has("cost") && (costPerHour !== null || pricing.length > 0) ? (
        <Section
          title="Cost estimate"
          note={`Local models are costed as measured time × $${costPerHour ?? 0}/hour, which is self-reported rather than metered; cloud models are costed from their configured per-token price. Not a bill.`}
        >
          <Table
            head={["Model", "Basis", "Time", "Tokens in/out", "Est. cost"]}
            rows={models.map((m) => {
              const local = m.provider === "local" || m.provider === "ollama";
              const estimate = estimateCost({
                local,
                model: m.model,
                totalLatencyMs: m.totalLatencyMs,
                promptTokens: m.totalPromptTokens,
                outputTokens: m.totalOutputTokens,
                perHour: costPerHour,
                pricing,
              });
              return [
                <Swatch key="m" color={colorOf(m)} label={m.label} />,
                estimate.basis === "machine"
                  ? "machine time"
                  : estimate.basis === "tokens"
                    ? "per token"
                    : "not priced",
                formatDuration(m.totalLatencyMs),
                `${m.totalPromptTokens?.toLocaleString("en") ?? "—"} / ${
                  m.totalOutputTokens?.toLocaleString("en") ?? "—"
                }`,
                estimate.amount === null ? "—" : `~${formatUsd(estimate.amount)}`,
              ];
            })}
          />
          {wallClockMs !== null && costPerHour !== null ? (
            <p className="text-muted-foreground mt-2 text-[10px]">
              Whole run wall clock: {formatDuration(wallClockMs)} ≈ ~
              {formatUsd(costOfMs(wallClockMs, costPerHour))} of machine time
            </p>
          ) : null}
        </Section>
      ) : null}

      <footer className="report-block border-border text-muted-foreground mt-6 border-t pt-2 text-[9px]">
        <p>
          Generated by Loom on {formatStamp(generatedAt)} · run {run.id}
        </p>
        <p className="mt-0.5">
          Requests ran one at a time, so latency and throughput are uncontended. Phase
          timings are measured at the HTTP boundary of each request.
        </p>
      </footer>
    </article>
  );
}
