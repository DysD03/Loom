"use client";

import { useState } from "react";
import { Activity, Gauge, Timer, TrendingUp, Waves } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatValue } from "@/components/dashboards/charts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import {
  BoxPlot,
  Dumbbell,
  Heatmap,
  PhaseBreakdown,
  PhaseLegend,
  Radar,
  RampLegend,
  Scatter,
  ScatterLegend,
  type BoxRow,
  type HeatCell,
  type PhaseRow,
  type RangeRow,
  type RadarAxis,
  type ScatterPoint,
} from "./charts";
import {
  buildProfile,
  buildVerdicts,
  PHASE_HINTS,
  PHASE_KEYS,
  PHASE_LABELS,
  type ConcurrencyPoint,
  type ConcurrencyReport,
  type ModelSummary,
  type RunSummaryView,
  type TaskCellView,
} from "@/lib/benchmark-score";

/** A metric that can be laid over the task × model grid. */
interface HeatMetric {
  key: string;
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  /** Legend ends, worst → best. */
  ends: [string, string];
  pick: (cell: TaskCellView) => number | null;
}

const HEAT_METRICS: HeatMetric[] = [
  {
    key: "latency",
    label: "Response time",
    unit: "ms",
    lowerIsBetter: true,
    ends: ["slower", "faster"],
    pick: (c) => c.latencyMs || null,
  },
  {
    key: "ttft",
    label: "Time to first token",
    unit: "ms",
    lowerIsBetter: true,
    ends: ["slower", "faster"],
    pick: (c) => c.ttftMs,
  },
  {
    key: "prefill",
    label: "Prefill time",
    unit: "ms",
    lowerIsBetter: true,
    ends: ["slower", "faster"],
    pick: (c) => c.phases?.prefill ?? null,
  },
  {
    key: "decode",
    label: "Decode time",
    unit: "ms",
    lowerIsBetter: true,
    ends: ["slower", "faster"],
    pick: (c) => c.phases?.decode ?? null,
  },
  {
    key: "decodeSpeed",
    label: "Decode speed",
    unit: "tok/s",
    lowerIsBetter: false,
    ends: ["slower", "faster"],
    pick: (c) => c.tokensPerSecond,
  },
  {
    key: "prefillSpeed",
    label: "Prefill throughput",
    unit: "tok/s",
    lowerIsBetter: false,
    ends: ["slower", "faster"],
    pick: (c) => c.prefillTokensPerSecond,
  },
  {
    key: "score",
    label: "Score",
    unit: "%",
    lowerIsBetter: false,
    ends: ["wrong", "right"],
    pick: (c) => c.score * 100,
  },
];

function Card({
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

function StatTile({
  icon: Icon,
  label,
  value,
  who,
  color,
}: {
  icon: typeof Timer;
  label: string;
  value: string;
  who: string;
  color: string;
}) {
  return (
    <div className="bg-card/80 flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2.5">
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Icon className="size-3.5" />
        {label}
      </p>
      <p className="text-lg leading-tight font-semibold tracking-tight">{value}</p>
      <p
        className="text-muted-foreground flex items-center gap-1.5 truncate text-xs"
        title={who}
      >
        <span
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ background: color }}
        />
        {who}
      </p>
    </div>
  );
}

const ms = (value: number | null): string =>
  value === null ? "—" : formatValue(value, "ms");
const tps = (value: number | null): string =>
  value === null ? "—" : formatValue(value, "tok/s");

/**
 * One model's parallel-load curve. The number that matters is not the latency
 * (which always worsens) but whether aggregate throughput grows at all: a local
 * server pinned to one model usually queues, so 4 in flight finish four times
 * slower and the total tokens/sec barely moves.
 */
function LoadCard({
  label,
  color,
  points,
}: {
  label: string;
  color: string;
  points: ConcurrencyPoint[];
}) {
  const base = points.find((p) => p.level === 1);
  const peak = points.reduce<ConcurrencyPoint | null>(
    (best, p) =>
      p.tokensPerSecond !== null && (best === null || p.tokensPerSecond > (best.tokensPerSecond ?? 0))
        ? p
        : best,
    null,
  );
  const scaling =
    base?.tokensPerSecond && peak?.tokensPerSecond
      ? peak.tokensPerSecond / base.tokensPerSecond
      : null;
  const maxTps = Math.max(...points.map((p) => p.tokensPerSecond ?? 0), 1);

  return (
    <div className="bg-card/80 min-w-0 rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <span aria-hidden="true" className="size-2 rounded-sm" style={{ background: color }} />
        <h3 className="font-mono text-sm font-medium">{label}</h3>
        {scaling !== null ? (
          <span className="text-muted-foreground text-xs">
            {peak?.level} in flight reaches {scaling.toFixed(2)}× the throughput of one
          </span>
        ) : null}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground text-left">
            <th className="pb-1 font-medium">In flight</th>
            <th className="pb-1 font-medium">Aggregate throughput</th>
            <th className="pb-1 text-right font-medium">Mean response</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.level}>
              <td className="py-1 pr-3" style={{ fontVariantNumeric: "tabular-nums" }}>
                {point.level}
                {point.errors > 0 ? (
                  <span className="text-neon-yellow ml-1.5" title={`${point.errors} failed`}>
                    ({point.errors} failed)
                  </span>
                ) : null}
              </td>
              <td className="py-1 pr-3">
                <span className="flex items-center gap-2">
                  <span className="bg-muted h-1.5 w-24 overflow-hidden rounded-full">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${((point.tokensPerSecond ?? 0) / maxTps) * 100}%`,
                        background: color,
                      }}
                    />
                  </span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {point.tokensPerSecond !== null
                      ? `${formatValue(point.tokensPerSecond)} tok/s`
                      : "—"}
                  </span>
                </span>
              </td>
              <td className="py-1 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatValue(point.latencyMs)} ms
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PerformancePanel({
  summary,
  colors,
  concurrency,
}: {
  summary: RunSummaryView;
  /** Model identity colors, aligned with `summary.models`. */
  colors: string[];
  /** Optional parallel-load probe, measured after the serial task loop. */
  concurrency: ConcurrencyReport;
}) {
  const [heatMetric, setHeatMetric] = useState(HEAT_METRICS[0].key);

  const models = summary.models.filter((m) => m.completed > 0);
  if (models.length === 0) return null;
  const colorOf = (m: ModelSummary) => colors[summary.models.indexOf(m)];

  const verdicts = buildVerdicts(summary);
  const profile = buildProfile(summary);

  const phaseRows: PhaseRow[] = models
    .filter(
      (m): m is ModelSummary & { phases: NonNullable<ModelSummary["phases"]> } =>
        m.phases !== null,
    )
    .map((m) => ({ label: m.label, color: colorOf(m), phases: m.phases }));

  const latencyRows: BoxRow[] = models
    .filter((m) => m.latency !== null && m.latency.count > 1)
    .map((m) => ({ label: m.label, color: colorOf(m), stats: m.latency! }));

  const ttftRows: BoxRow[] = models
    .filter((m) => m.ttft !== null && m.ttft.count > 1)
    .map((m) => ({ label: m.label, color: colorOf(m), stats: m.ttft! }));

  const speedRows: BoxRow[] = models
    .filter((m) => m.decodeSpeed !== null && m.decodeSpeed.count > 1)
    .map((m) => ({ label: m.label, color: colorOf(m), stats: m.decodeSpeed! }));

  const jitterRows: RangeRow[] = models
    .filter((m) => m.interToken !== null)
    .map((m) => ({
      label: m.label,
      color: colorOf(m),
      from: m.interToken!.p50,
      to: m.interToken!.p95,
    }));

  const scatterPoints: ScatterPoint[] = models
    .filter((m) => m.scoredCompleted > 0 && m.avgTokensPerSecond !== null)
    .map((m) => ({
      label: m.label,
      color: colorOf(m),
      x: m.avgTokensPerSecond!,
      y: m.score * 100,
    }));

  const metric = HEAT_METRICS.find((m) => m.key === heatMetric) ?? HEAT_METRICS[0];
  const heatCells: HeatCell[][] = summary.tasks.map((task) =>
    summary.models.map((_, mi) => {
      const cell = task.cells[mi];
      const value = cell ? metric.pick(cell) : null;
      return { value, text: value === null ? "—" : formatValue(value, metric.unit) };
    }),
  );

  const tiles: React.ReactNode[] = [];
  const pushTile = (
    index: number | null,
    icon: typeof Timer,
    label: string,
    value: (m: ModelSummary) => string | null,
  ) => {
    if (index === null) return;
    const m = summary.models[index];
    const text = value(m);
    if (text === null) return;
    tiles.push(
      <StatTile
        key={label}
        icon={icon}
        label={label}
        value={text}
        who={m.label}
        color={colors[index]}
      />,
    );
  };
  pushTile(verdicts.ranked[0] ?? null, TrendingUp, "Most accurate", (m) =>
    m.scoredCompleted > 0 ? `${Math.round(m.score * 100)}%` : null,
  );
  pushTile(verdicts.fastestLatency, Timer, "Fastest turnaround", (m) =>
    ms(m.avgLatencyMs),
  );
  pushTile(verdicts.fastestGeneration, Gauge, "Peak decode", (m) =>
    tps(m.avgTokensPerSecond),
  );
  pushTile(verdicts.fastestPrefill, Activity, "Peak prefill", (m) =>
    tps(m.avgPrefillTokensPerSecond),
  );
  pushTile(verdicts.mostConsistent, Waves, "Steadiest", (m) =>
    m.latency !== null ? `±${Math.round(m.latency.cv * 100)}%` : null,
  );

  // The probe is keyed by model, so a swept run shows one curve per model, not
  // one per variant — sampling temperature does not change how a server queues.
  const loadModels = Object.entries(concurrency.models)
    .filter(([, points]) => points.length > 0)
    .map(([model, points]) => {
      const owner = models.find((m) => m.model === model || m.model.startsWith(`${model}@t=`));
      return {
        model,
        label: owner?.label.split(" @ ")[0] ?? model,
        color: owner ? colorOf(owner) : colors[0],
        points,
      };
    });

  // A server that streams no usage object leaves every token-derived metric
  // null, which reads as a broken tab rather than a missing server feature.
  const noTokenCounts = models.every(
    (m) =>
      m.avgTokensPerSecond === null &&
      m.avgPrefillTokensPerSecond === null &&
      m.avgTpotMs === null,
  );

  const hasPhases = phaseRows.length > 0;
  const hasProfile = profile.length >= 3 && models.length > 1;

  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
        <span className="bg-neon-cyan mr-2 inline-block h-2.5 w-0.5 align-[-1px]" />
        Performance
        <span className="text-muted-foreground/70 ml-2 normal-case">
          (every request split into encode → queue → prefill → decode)
        </span>
      </h2>

      {tiles.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {tiles}
        </div>
      ) : null}

      <Tabs defaultValue="latency">
        <TabsList>
          <TabsTab value="latency">Latency</TabsTab>
          <TabsTab value="throughput">Throughput</TabsTab>
          <TabsTab value="profile">Profile</TabsTab>
          <TabsTab value="matrix">Per task</TabsTab>
          <TabsTab value="table">All metrics</TabsTab>
          {loadModels.length > 0 ? <TabsTab value="load">Under load</TabsTab> : null}
        </TabsList>

        <TabsPanel value="latency" className="space-y-3 pt-2">
          {hasPhases ? (
            <Card
              title="Where the time goes"
              hint="Mean milliseconds per phase of a request. The four phases add up to the response time, so the bar is the whole wait."
              legend={<PhaseLegend />}
            >
              <PhaseBreakdown rows={phaseRows} title="Request phase breakdown" />
              <dl className="text-muted-foreground mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                {PHASE_KEYS.map((key) => (
                  <div key={key} className="flex gap-1.5">
                    <dt className="text-foreground shrink-0 font-medium">
                      {PHASE_LABELS[key]}
                    </dt>
                    <dd>{PHASE_HINTS[key]}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          ) : null}

          {latencyRows.length > 0 ? (
            <Card
              title="Response time spread"
              hint="Box spans the middle half of the run's tasks, the rule is the median, the ringed dot is p95, whiskers reach the fastest and slowest task."
            >
              <BoxPlot rows={latencyRows} title="Response time distribution" unit="ms" />
            </Card>
          ) : null}

          {ttftRows.length > 0 ? (
            <Card
              title="Time to first token spread"
              hint="How long the model keeps a reader waiting before anything appears — and how far the worst case drifts."
            >
              <BoxPlot
                rows={ttftRows}
                title="Time to first token distribution"
                unit="ms"
              />
            </Card>
          ) : null}

          {jitterRows.length > 0 ? (
            <Card
              title="Inter-token gap: median → p95"
              hint="Steady-state pause between streamed chunks. A long bar means the stream stutters even when the average looks fine."
            >
              <Dumbbell
                rows={jitterRows}
                title="Inter-token latency, median to p95"
                unit="ms"
                fromLabel="median gap"
                toLabel="p95 gap"
              />
            </Card>
          ) : null}
        </TabsPanel>

        <TabsPanel value="throughput" className="space-y-3 pt-2">
          {noTokenCounts ? (
            <div className="border-neon-yellow/40 bg-neon-yellow/5 flex items-start gap-2.5 rounded-lg border px-4 py-3">
              <Gauge className="text-neon-yellow mt-0.5 size-4 shrink-0" />
              <p className="text-muted-foreground text-xs leading-relaxed">
                No model in this run reported token counts, so every throughput number
                here is blank — the timings above are unaffected. Loom asks for them
                (<code>stream_options.include_usage</code>); a server that answers
                without a usage object leaves nothing to divide by. Update the server, or
                re-run once it reports usage.
              </p>
            </div>
          ) : null}

          {speedRows.length > 0 ? (
            <Card
              title="Decode speed spread"
              hint="Output tokens per second across the run's tasks, measured over decode time only."
            >
              <BoxPlot rows={speedRows} title="Decode speed distribution" unit="tok/s" />
            </Card>
          ) : null}

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <Card
              title="Prefill throughput"
              hint="Prompt tokens the server chews through per second, from the first turn only — later turns hit its prefix cache."
            >
              <SimpleRanking
                rows={models
                  .filter((m) => m.avgPrefillTokensPerSecond !== null)
                  .map((m) => ({
                    label: m.label,
                    color: colorOf(m),
                    value: m.avgPrefillTokensPerSecond!,
                    text: tps(m.avgPrefillTokensPerSecond),
                  }))}
                empty="No prefill measurements yet."
              />
            </Card>
            <Card
              title="Time per output token"
              hint="Decode time divided by tokens produced — the reciprocal of decode speed, in the units a reader feels."
            >
              <SimpleRanking
                lowerIsBetter
                rows={models
                  .filter((m) => m.avgTpotMs !== null)
                  .map((m) => ({
                    label: m.label,
                    color: colorOf(m),
                    value: m.avgTpotMs!,
                    text: ms(m.avgTpotMs),
                  }))}
                empty="No decode measurements yet."
              />
            </Card>
          </div>
        </TabsPanel>

        <TabsPanel value="profile" className="space-y-3 pt-2">
          {hasProfile ? (
            <Card
              title="Performance profile"
              hint="Each axis is scaled so the run's best model sits on the outer ring — the gap to the ring is what this model gives up."
            >
              <div className="flex flex-wrap gap-4">
                {models.map((m) => {
                  const mi = summary.models.indexOf(m);
                  const axes: RadarAxis[] = profile.map((axis) => ({
                    label: axis.label,
                    value: axis.values[mi],
                    detail:
                      axis.raw[mi] === null ? "no data" : formatValue(axis.raw[mi], axis.unit),
                  }));
                  return (
                    <figure key={m.model} className="flex flex-col items-center gap-1">
                      <Radar axes={axes} color={colorOf(m)} label={m.label} />
                      <figcaption
                        className="flex max-w-44 items-center gap-1.5 truncate text-xs"
                        title={m.model}
                      >
                        <span
                          className="inline-block size-2 shrink-0 rounded-full"
                          style={{ background: colorOf(m) }}
                        />
                        <span className="truncate font-mono">{m.label}</span>
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            </Card>
          ) : (
            <p className="text-muted-foreground text-xs">
              The profile radar needs at least two models and three measured axes.
            </p>
          )}

          {scatterPoints.length > 1 ? (
            <Card
              title="Accuracy against speed"
              hint="Up and to the right wins. Anything left behind on both axes is dominated — there is a model that is both more accurate and faster."
              legend={<ScatterLegend points={scatterPoints} />}
            >
              <Scatter
                points={scatterPoints}
                title="Accuracy against decode speed"
                xLabel="Decode speed"
                yLabel="Accuracy"
                xUnit="tok/s"
                yUnit="%"
              />
            </Card>
          ) : null}
        </TabsPanel>

        <TabsPanel value="matrix" className="space-y-3 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={heatMetric} onValueChange={(v) => v && setHeatMetric(v)}>
              <SelectTrigger size="sm" className="w-52" aria-label="Heatmap metric">
                <SelectValue>
                  {(v: string) => HEAT_METRICS.find((m) => m.key === v)?.label ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {HEAT_METRICS.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ml-auto">
              <RampLegend low={metric.ends[0]} high={metric.ends[1]} />
            </div>
          </div>
          <Card
            title={`${metric.label} per task`}
            hint="One cell per model and task. The shade ranks the cell within this run; the number is always there too."
          >
            <Heatmap
              rowLabels={summary.tasks.map((t) => t.name)}
              columnLabels={summary.models.map((m) => m.label)}
              columnColors={colors}
              cells={heatCells}
              lowerIsBetter={metric.lowerIsBetter}
            />
          </Card>
        </TabsPanel>

        {loadModels.length > 0 ? (
          <TabsPanel value="load" className="space-y-3 pt-2">
            <p className="text-muted-foreground text-xs leading-relaxed">
              Measured after the task loop, on its own fixed prompt, so the contended
              requests never landed inside a timed task. Aggregate throughput is the
              batch&apos;s output tokens over the batch&apos;s wall clock — if it stays flat
              as requests are
              added, the server is queueing rather than serving them in parallel.
            </p>
            <div className={cn("grid gap-3", loadModels.length > 1 && "xl:grid-cols-2")}>
              {loadModels.map((entry) => (
                <LoadCard
                  key={entry.model}
                  label={entry.label}
                  color={entry.color}
                  points={entry.points}
                />
              ))}
            </div>
          </TabsPanel>
        ) : null}

        <TabsPanel value="table" className="pt-2">
          <MetricsTable summary={summary} colors={colors} />
        </TabsPanel>
      </Tabs>
    </section>
  );
}

/**
 * A ranked bar list — the honest form for one measure across a handful of
 * entities, where a full axis would be more chrome than data.
 */
function SimpleRanking({
  rows,
  empty,
  lowerIsBetter = false,
}: {
  rows: { label: string; color: string; value: number; text: string }[];
  empty: string;
  lowerIsBetter?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-xs">{empty}</p>;
  }
  const max = Math.max(...rows.map((r) => r.value));
  const sorted = [...rows].sort((a, b) =>
    lowerIsBetter ? a.value - b.value : b.value - a.value,
  );
  return (
    <ul className="space-y-2">
      {sorted.map((row) => (
        <li key={row.label} className="flex items-center gap-2 text-xs">
          <span
            className="inline-block size-2 shrink-0 rounded-full"
            style={{ background: row.color }}
          />
          <span className="w-28 shrink-0 truncate font-mono" title={row.label}>
            {row.label}
          </span>
          <span className="bg-muted h-2 min-w-0 flex-1 overflow-hidden rounded-full">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${max > 0 ? (row.value / max) * 100 : 0}%`,
                background: row.color,
              }}
            />
          </span>
          <span
            className="w-20 shrink-0 text-right font-medium"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {row.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

const COLUMNS: { label: string; hint: string; value: (m: ModelSummary) => string }[] = [
  {
    label: "Score",
    hint: "Mean score over the scored tasks",
    value: (m) => (m.scoredCompleted > 0 ? `${Math.round(m.score * 100)}%` : "—"),
  },
  { label: "Avg", hint: "Mean response time", value: (m) => ms(m.avgLatencyMs) },
  {
    label: "p50",
    hint: "Median response time",
    value: (m) => ms(m.latency?.median ?? null),
  },
  { label: "p95", hint: "Tail response time", value: (m) => ms(m.latency?.p95 ?? null) },
  {
    label: "Spread",
    hint: "Standard deviation ÷ mean response time",
    value: (m) =>
      m.latency !== null && m.latency.count > 1
        ? `±${Math.round(m.latency.cv * 100)}%`
        : "—",
  },
  { label: "TTFT", hint: "Mean time to first token", value: (m) => ms(m.avgTtftMs) },
  {
    label: "Encode",
    hint: "Mean request-encode time",
    value: (m) => ms(m.phases?.encode ?? null),
  },
  {
    label: "Queue",
    hint: "Mean dispatch-to-response time",
    value: (m) => ms(m.phases?.queue ?? null),
  },
  {
    label: "Prefill",
    hint: "Mean prompt-evaluation time",
    value: (m) => ms(m.phases?.prefill ?? null),
  },
  {
    label: "Decode",
    hint: "Mean generation time",
    value: (m) => ms(m.phases?.decode ?? null),
  },
  {
    label: "Decode tok/s",
    hint: "Output tokens ÷ decode time",
    value: (m) => tps(m.avgTokensPerSecond),
  },
  {
    label: "Prefill tok/s",
    hint: "First-turn prompt tokens ÷ prefill time",
    value: (m) => tps(m.avgPrefillTokensPerSecond),
  },
  { label: "TPOT", hint: "Decode time ÷ output tokens", value: (m) => ms(m.avgTpotMs) },
  {
    label: "ITL p50/p95",
    hint: "Median and tail gap between streamed chunks",
    value: (m) =>
      m.interToken === null
        ? "—"
        : `${Math.round(m.interToken.p50)} / ${Math.round(m.interToken.p95)} ms`,
  },
  {
    label: "Cold start",
    hint: "Warmup request, mostly weight loading — excluded from every other column",
    value: (m) => ms(m.coldStartMs),
  },
  {
    label: "Tokens in/out",
    hint: "Prompt and output tokens across the run",
    value: (m) =>
      `${m.totalPromptTokens?.toLocaleString("en") ?? "—"} / ${
        m.totalOutputTokens?.toLocaleString("en") ?? "—"
      }`,
  },
];

/** The table twin of the performance charts — every number, nothing gated behind a hover. */
function MetricsTable({
  summary,
  colors,
}: {
  summary: RunSummaryView;
  colors: string[];
}) {
  return (
    <div className="bg-card/80 overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            <th className="text-muted-foreground px-3 py-2 text-left font-medium">
              Model
            </th>
            {COLUMNS.map((col) => (
              <th
                key={col.label}
                className="text-muted-foreground px-2 py-2 text-right font-medium whitespace-nowrap"
                title={col.hint}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summary.models.map((m, mi) => (
            <tr key={m.model} className="border-border/50 border-b last:border-0">
              <td className="px-3 py-2">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block size-2 shrink-0 rounded-full"
                    style={{ background: colors[mi] }}
                  />
                  <span className="max-w-40 truncate font-mono" title={m.model}>
                    {m.label}
                  </span>
                </span>
              </td>
              {COLUMNS.map((col) => (
                <td
                  key={col.label}
                  className={cn(
                    "px-2 py-2 text-right whitespace-nowrap",
                    col.label === "Score" ? "text-foreground" : "text-muted-foreground",
                  )}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {col.value(m)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
