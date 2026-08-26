"use client";

import { useState, type ReactNode } from "react";

import {
  buildScale,
  formatValue,
  Tooltip,
  truncate,
  useWidth,
  type TooltipState,
} from "@/components/dashboards/charts";
import {
  PHASE_KEYS,
  PHASE_LABELS,
  type Distribution,
  type LatencyPhases,
} from "@/lib/benchmark-score";

/**
 * Benchmark-specific chart forms, built on the app's chart kit
 * (`components/dashboards/charts`) so scales, tooltips, and the categorical
 * model palette stay identical across surfaces.
 *
 * Two ordinal ramps live here. Both are single-hue, monotone in lightness, and
 * were checked with the dataviz ordinal validator against the card surface
 * (#10101c): adjacent ΔL ≥ 0.06 and the dim end still ≥ 2:1 against the card.
 * Neither may be reordered or extended by eye.
 */

/**
 * The ordinal ramps a chart needs, per surface. Categorical model colors come
 * from the caller (`seriesColor`) and are validated on both surfaces, so only
 * the ramps and the in-fill ink vary between screen and paper.
 */
export interface VizPalette {
  /** Four steps, least → most prominent: one per request phase, in pipeline order. */
  phase: string[];
  /** Six steps, low → high magnitude, for the heatmap. */
  sequential: string[];
  /** Cell background when a task never ran against a model. */
  empty: string;
  /** Ink used on the dark end of a ramp fill. */
  inkOnDark: string;
  /** Ink used on the light end of a ramp fill. */
  inkOnLight: string;
}

/** Dark app surface (#10101c) — ramps run dim → bright. */
export const SCREEN_PALETTE: VizPalette = {
  phase: ["#0a5f6c", "#0197a2", "#4fb9c3", "#a5d7de"],
  sequential: ["#09525d", "#057480", "#0197a2", "#26adb8", "#5dbec8", "#94cfd8"],
  empty: "#1b1b2c",
  inkOnDark: "#e2f2f5",
  inkOnLight: "#06131a",
};

/** White paper (#ffffff) — ramps run light → dark, as print convention expects. */
export const PAPER_PALETTE: VizPalette = {
  phase: ["#59c3ca", "#26b0b9", "#009ba6", "#028089"],
  sequential: ["#59c3ca", "#26b0b9", "#009ba6", "#028089", "#04646d", "#054850"],
  empty: "#eef0f3",
  inkOnDark: "#f4fbfc",
  inkOnLight: "#06131a",
};

const SURFACE = "var(--card)";

/** Gap between touching marks — surface showing through, never a stroke. */
const GAP = 2;

const clamp = (value: number, lo: number, hi: number) =>
  Math.min(Math.max(value, lo), hi);

export function phaseColor(index: number, palette: VizPalette = SCREEN_PALETTE): string {
  return palette.phase[index % palette.phase.length];
}

/** Maps 0..1 onto the sequential ramp. */
export function rampColor(t: number, palette: VizPalette = SCREEN_PALETTE): string {
  const ramp = palette.sequential;
  if (!Number.isFinite(t)) return palette.empty;
  return ramp[clamp(Math.round(t * (ramp.length - 1)), 0, ramp.length - 1)];
}

/** WCAG relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/**
 * Ink for text set inside a ramp fill — the one place a label may take its color
 * from its background, so it clears contrast at both ends of the ramp.
 */
function inkOn(fill: string, palette: VizPalette): string {
  return luminance(fill) > 0.3 ? palette.inkOnLight : palette.inkOnDark;
}

// --- phase breakdown -------------------------------------------------------

export interface PhaseRow {
  label: string;
  /** The model's identity color — carried by the row's dot, not by its segments. */
  color: string;
  phases: LatencyPhases;
}

const ROW_LABEL_MAX = 150;
const BAR_H = 16;

function labelGutter(labels: string[]): number {
  const longest = Math.max(...labels.map((l) => l.length), 4);
  return clamp(longest * 6.4 + 18, 64, ROW_LABEL_MAX);
}

/**
 * Where each request's time went, as a part-to-whole stack per model. Segments
 * follow the pipeline order encode → queue → prefill → decode and are separated
 * by a 2px surface gap; the total rides at the end of the bar.
 */
export function PhaseBreakdown({
  rows,
  title,
  palette = SCREEN_PALETTE,
}: {
  rows: PhaseRow[];
  title: string;
  palette?: VizPalette;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);

  const totals = rows.map((r) => PHASE_KEYS.reduce((sum, k) => sum + r.phases[k], 0));
  const scale = buildScale(totals);
  const left = labelGutter(rows.map((r) => r.label));
  const right = 56;
  const plotW = Math.max(width - left - right, 40);
  const rowH = 34;
  const top = 6;
  const height = top + rows.length * rowH + 20;
  const x = (v: number) => left + (v / (scale.hi || 1)) * plotW;

  return (
    <div ref={ref} className="relative">
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={title}>
          {scale.ticks.map((t) => (
            <g key={t}>
              <line
                x1={x(t)}
                x2={x(t)}
                y1={top}
                y2={top + rows.length * rowH}
                className="stroke-border"
                strokeWidth={1}
                opacity={t === 0 ? 1 : 0.55}
              />
              <text
                x={x(t)}
                y={height - 6}
                textAnchor="middle"
                fontSize={10}
                className="fill-muted-foreground"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatValue(t, "ms")}
              </text>
            </g>
          ))}
          {rows.map((row, ri) => {
            const y = top + ri * rowH + (rowH - BAR_H) / 2;
            let cursor = 0;
            return (
              <g key={row.label}>
                <circle cx={8} cy={y + BAR_H / 2} r={3.5} fill={row.color} />
                <text
                  x={18}
                  y={y + BAR_H / 2 + 3.5}
                  fontSize={10}
                  className="fill-muted-foreground"
                >
                  {truncate(row.label, Math.floor((left - 24) / 6.4))}
                </text>
                {PHASE_KEYS.map((key, pi) => {
                  const value = row.phases[key];
                  const x0 = x(cursor);
                  cursor += value;
                  const x1 = x(cursor);
                  const w = Math.max(x1 - x0 - (pi < PHASE_KEYS.length - 1 ? GAP : 0), 0);
                  if (w <= 0.5) return null;
                  return (
                    <rect
                      key={key}
                      x={x0}
                      y={y}
                      width={w}
                      height={BAR_H}
                      rx={pi === PHASE_KEYS.length - 1 ? 4 : 1}
                      fill={phaseColor(pi, palette)}
                    />
                  );
                })}
                <text
                  x={x(totals[ri]) + 6}
                  y={y + BAR_H / 2 + 3.5}
                  fontSize={10}
                  className="fill-foreground"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatValue(totals[ri], "ms")}
                </text>
                <rect
                  x={0}
                  y={top + ri * rowH}
                  width={width}
                  height={rowH}
                  fill="transparent"
                  onMouseEnter={() =>
                    setTip({
                      x: left + plotW / 2,
                      y: top + ri * rowH + 4,
                      content: (
                        <div className="space-y-0.5">
                          <p className="text-muted-foreground font-medium">{row.label}</p>
                          {PHASE_KEYS.map((key, pi) => (
                            <p
                              key={key}
                              className="flex items-center gap-1.5 whitespace-nowrap"
                            >
                              <span
                                className="inline-block size-2 rounded-full"
                                style={{ background: phaseColor(pi, palette) }}
                              />
                              <span className="text-muted-foreground">
                                {PHASE_LABELS[key]}
                              </span>
                              <span className="font-medium">
                                {formatValue(row.phases[key], "ms")}
                              </span>
                              <span className="text-muted-foreground">
                                {totals[ri] > 0
                                  ? `${Math.round((row.phases[key] / totals[ri]) * 100)}%`
                                  : ""}
                              </span>
                            </p>
                          ))}
                        </div>
                      ),
                    })
                  }
                  onMouseLeave={() => setTip(null)}
                />
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {tip ? <Tooltip tip={tip} width={width} /> : null}
    </div>
  );
}

/** Key for the phase ramp — the stack's segments are ordered, not categorical. */
export function PhaseLegend({ palette = SCREEN_PALETTE }: { palette?: VizPalette }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {PHASE_KEYS.map((key, i) => (
        <span
          key={key}
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
        >
          <span
            className="inline-block h-2 w-4 rounded-sm"
            style={{ background: phaseColor(i, palette) }}
          />
          {PHASE_LABELS[key]}
        </span>
      ))}
    </div>
  );
}

// --- distribution (box & whisker) ------------------------------------------

export interface BoxRow {
  label: string;
  color: string;
  stats: Distribution;
}

/**
 * Spread of a metric per model: whiskers to min/max, box across the quartiles,
 * a median rule, and a p95 tick. Says what an average hides — a model with a
 * good mean and a long tail looks different here.
 */
export function BoxPlot({
  rows,
  title,
  unit,
}: {
  rows: BoxRow[];
  title: string;
  unit: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);

  const scale = buildScale(rows.flatMap((r) => [r.stats.min, r.stats.max]));
  const left = labelGutter(rows.map((r) => r.label));
  // Room for the last tick label, which is centred on the axis end.
  const right = 36;
  const plotW = Math.max(width - left - right, 40);
  const rowH = 36;
  const boxH = 16;
  const top = 6;
  const height = top + rows.length * rowH + 20;
  const span = scale.hi - scale.lo || 1;
  const x = (v: number) => left + ((v - scale.lo) / span) * plotW;

  return (
    <div ref={ref} className="relative">
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={title}>
          {scale.ticks.map((t) => (
            <g key={t}>
              <line
                x1={x(t)}
                x2={x(t)}
                y1={top}
                y2={top + rows.length * rowH}
                className="stroke-border"
                strokeWidth={1}
                opacity={t === 0 ? 1 : 0.55}
              />
              <text
                x={x(t)}
                y={height - 6}
                textAnchor="middle"
                fontSize={10}
                className="fill-muted-foreground"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatValue(t, unit)}
              </text>
            </g>
          ))}
          {rows.map((row, ri) => {
            const s = row.stats;
            const cy = top + ri * rowH + rowH / 2;
            const boxY = cy - boxH / 2;
            return (
              <g key={row.label}>
                <circle cx={8} cy={cy} r={3.5} fill={row.color} />
                <text x={18} y={cy + 3.5} fontSize={10} className="fill-muted-foreground">
                  {truncate(row.label, Math.floor((left - 24) / 6.4))}
                </text>
                <line
                  x1={x(s.min)}
                  x2={x(s.max)}
                  y1={cy}
                  y2={cy}
                  stroke={row.color}
                  strokeWidth={1.5}
                  opacity={0.5}
                />
                {[s.min, s.max].map((v, i) => (
                  <line
                    key={i}
                    x1={x(v)}
                    x2={x(v)}
                    y1={cy - 5}
                    y2={cy + 5}
                    stroke={row.color}
                    strokeWidth={1.5}
                    opacity={0.5}
                  />
                ))}
                <rect
                  x={x(s.q1)}
                  y={boxY}
                  width={Math.max(x(s.q3) - x(s.q1), 2)}
                  height={boxH}
                  rx={3}
                  fill={row.color}
                  opacity={0.32}
                />
                <line
                  x1={x(s.median)}
                  x2={x(s.median)}
                  y1={boxY}
                  y2={boxY + boxH}
                  stroke={row.color}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                />
                <circle
                  cx={x(s.p95)}
                  cy={cy}
                  r={3.5}
                  fill={row.color}
                  style={{ stroke: SURFACE }}
                  strokeWidth={2}
                />
                <rect
                  x={0}
                  y={top + ri * rowH}
                  width={width}
                  height={rowH}
                  fill="transparent"
                  onMouseEnter={() =>
                    setTip({
                      x: x(s.median),
                      y: top + ri * rowH + 4,
                      content: (
                        <div className="space-y-0.5">
                          <p className="text-muted-foreground font-medium">{row.label}</p>
                          {(
                            [
                              ["min", s.min],
                              ["p25", s.q1],
                              ["median", s.median],
                              ["p75", s.q3],
                              ["p95", s.p95],
                              ["max", s.max],
                            ] as const
                          ).map(([name, value]) => (
                            <p key={name} className="flex gap-2 whitespace-nowrap">
                              <span className="text-muted-foreground w-12">{name}</span>
                              <span className="font-medium">
                                {formatValue(value, unit)}
                              </span>
                            </p>
                          ))}
                          <p className="text-muted-foreground pt-0.5">
                            {s.count} task{s.count === 1 ? "" : "s"} · spread{" "}
                            {Math.round(s.cv * 100)}%
                          </p>
                        </div>
                      ),
                    })
                  }
                  onMouseLeave={() => setTip(null)}
                />
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {tip ? <Tooltip tip={tip} width={width} /> : null}
    </div>
  );
}

// --- scatter (quality vs speed) --------------------------------------------

export interface ScatterPoint {
  label: string;
  color: string;
  x: number;
  y: number;
}

/**
 * Marker shapes double up the identity channel. Scatter compares every pair of
 * marks at once, and the five-hue categorical palette is only pair-safe for
 * neighbours — so shape (plus a direct label) carries identity here, not hue.
 */
function marker(
  index: number,
  cx: number,
  cy: number,
  r: number,
  color: string,
): ReactNode {
  const common = { fill: color, style: { stroke: SURFACE }, strokeWidth: 2 };
  switch (index % 5) {
    case 0:
      return <circle cx={cx} cy={cy} r={r} {...common} />;
    case 1:
      return (
        <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} rx={1} {...common} />
      );
    case 2:
      return (
        <polygon
          points={`${cx},${cy - r - 1} ${cx + r + 1},${cy + r} ${cx - r - 1},${cy + r}`}
          {...common}
        />
      );
    case 3:
      return (
        <polygon
          points={`${cx},${cy - r - 1} ${cx + r + 1},${cy} ${cx},${cy + r + 1} ${cx - r - 1},${cy}`}
          {...common}
        />
      );
    default:
      return (
        <polygon
          points={`${cx},${cy + r + 1} ${cx + r + 1},${cy - r} ${cx - r - 1},${cy - r}`}
          {...common}
        />
      );
  }
}

/** The shape key that goes with a `Scatter` — identity without relying on hue. */
export function ScatterLegend({ points }: { points: ScatterPoint[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {points.map((p, i) => (
        <span
          key={p.label}
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
        >
          <svg width={12} height={12} aria-hidden="true">
            {marker(i, 6, 6, 4, p.color)}
          </svg>
          {p.label}
        </span>
      ))}
    </div>
  );
}

export function Scatter({
  points,
  title,
  xLabel,
  yLabel,
  xUnit,
  yUnit,
}: {
  points: ScatterPoint[];
  title: string;
  xLabel: string;
  yLabel: string;
  xUnit: string;
  yUnit: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const xScale = buildScale(points.map((p) => p.x));
  const yScale = buildScale(points.map((p) => p.y));
  const left = 48;
  const right = 36;
  const top = 12;
  const plotH = 200;
  const bottom = 38;
  const height = top + plotH + bottom;
  const plotW = Math.max(width - left - right, 40);
  const px = (v: number) =>
    left + ((v - xScale.lo) / (xScale.hi - xScale.lo || 1)) * plotW;
  const py = (v: number) =>
    top + ((yScale.hi - v) / (yScale.hi - yScale.lo || 1)) * plotH;

  return (
    <div ref={ref} className="relative">
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={title}>
          {yScale.ticks.map((t) => (
            <g key={`y${t}`}>
              <line
                x1={left}
                x2={left + plotW}
                y1={py(t)}
                y2={py(t)}
                className="stroke-border"
                strokeWidth={1}
                opacity={t === 0 ? 1 : 0.55}
              />
              <text
                x={left - 6}
                y={py(t) + 3}
                textAnchor="end"
                fontSize={10}
                className="fill-muted-foreground"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatValue(t, yUnit)}
              </text>
            </g>
          ))}
          {xScale.ticks.map((t) => (
            <text
              key={`x${t}`}
              x={px(t)}
              y={top + plotH + 14}
              textAnchor="middle"
              fontSize={10}
              className="fill-muted-foreground"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatValue(t, xUnit)}
            </text>
          ))}
          <text
            x={left + plotW / 2}
            y={height - 4}
            textAnchor="middle"
            fontSize={10}
            className="fill-muted-foreground"
          >
            {xLabel} →
          </text>
          <text
            x={-(top + plotH / 2)}
            y={11}
            transform="rotate(-90)"
            textAnchor="middle"
            fontSize={10}
            className="fill-muted-foreground"
          >
            {yLabel} →
          </text>
          {points.map((p, i) => (
            <g
              key={p.label}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {/* Generous transparent hit target — the mark itself is 8px. */}
              <circle cx={px(p.x)} cy={py(p.y)} r={14} fill="transparent" />
              {marker(i, px(p.x), py(p.y), 5, p.color)}
              <text
                x={px(p.x) + (px(p.x) > left + plotW * 0.75 ? -10 : 10)}
                y={py(p.y) + 3.5}
                textAnchor={px(p.x) > left + plotW * 0.75 ? "end" : "start"}
                fontSize={10}
                className="fill-foreground"
              >
                {truncate(p.label, 14)}
              </text>
            </g>
          ))}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {hover !== null && width > 0 ? (
        <Tooltip
          tip={{
            x: px(points[hover].x),
            y: py(points[hover].y),
            content: (
              <div className="space-y-0.5">
                <p className="text-muted-foreground font-medium">{points[hover].label}</p>
                <p className="whitespace-nowrap">
                  <span className="text-muted-foreground">{yLabel}: </span>
                  <span className="font-medium">
                    {formatValue(points[hover].y, yUnit)}
                  </span>
                </p>
                <p className="whitespace-nowrap">
                  <span className="text-muted-foreground">{xLabel}: </span>
                  <span className="font-medium">
                    {formatValue(points[hover].x, xUnit)}
                  </span>
                </p>
              </div>
            ),
          }}
          width={width}
        />
      ) : null}
    </div>
  );
}

// --- radar (per-model performance profile) ---------------------------------

export interface RadarAxis {
  label: string;
  /** 0..100, where 100 is the run's best on this axis. */
  value: number | null;
  /** The raw metric behind `value`, already formatted. */
  detail: string;
}

const RADAR_W = 252;
const RADAR_H = 200;
const RADAR_R = 62;
/** Ring-to-label gap; the box above is sized so a label never leaves the card. */
const RADAR_LABEL_GAP = 13;

/**
 * One model's profile against the field. Every axis is scaled so the run's best
 * model sits on the outer ring, which makes the gap to the ring the story. Drawn
 * as small multiples — one card per model — because a single radar with five
 * overlapping polygons is not distinguishable pair-by-pair under CVD.
 */
export function Radar({
  axes,
  color,
  label,
}: {
  axes: RadarAxis[];
  color: string;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const cx = RADAR_W / 2;
  const cy = RADAR_H / 2;
  const angle = (i: number) => -Math.PI / 2 + (i / axes.length) * Math.PI * 2;
  const point = (i: number, radius: number) => ({
    x: cx + radius * Math.cos(angle(i)),
    y: cy + radius * Math.sin(angle(i)),
  });
  const polygon = axes
    .map((a, i) => {
      const p = point(i, ((a.value ?? 0) / 100) * RADAR_R);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="relative">
      <svg
        width={RADAR_W}
        height={RADAR_H}
        role="img"
        aria-label={`${label} performance profile`}
      >
        {[0.25, 0.5, 0.75, 1].map((ring) => (
          <polygon
            key={ring}
            points={axes
              .map((_, i) => {
                const p = point(i, RADAR_R * ring);
                return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
              })
              .join(" ")}
            fill="none"
            className="stroke-border"
            strokeWidth={1}
            opacity={ring === 1 ? 1 : 0.55}
          />
        ))}
        {axes.map((_, i) => {
          const p = point(i, RADAR_R);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={p.x}
              y2={p.y}
              className="stroke-border"
              strokeWidth={1}
              opacity={0.55}
            />
          );
        })}
        <polygon points={polygon} fill={color} opacity={0.18} />
        <polygon
          points={polygon}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {axes.map((a, i) => {
          const p = point(i, ((a.value ?? 0) / 100) * RADAR_R);
          const outer = point(i, RADAR_R + RADAR_LABEL_GAP);
          // Anchor by quadrant so a label leans away from the ring, never over it.
          const dx = outer.x - cx;
          const dy = outer.y - cy;
          const anchor = Math.abs(dx) < 8 ? "middle" : dx > 0 ? "start" : "end";
          const baseline = Math.abs(dy) < 8 ? 3 : dy > 0 ? 9 : -3;
          return (
            <g
              key={a.label}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={4}
                fill={color}
                style={{ stroke: SURFACE }}
                strokeWidth={2}
              />
              <text
                x={outer.x}
                y={outer.y + baseline}
                textAnchor={anchor}
                fontSize={9}
                className="fill-muted-foreground"
              >
                {truncate(a.label, 12)}
              </text>
              <circle cx={p.x} cy={p.y} r={12} fill="transparent" />
            </g>
          );
        })}
      </svg>
      {hover !== null ? (
        <Tooltip
          tip={{
            x: cx,
            y: 14,
            content: (
              <div className="space-y-0.5">
                <p className="text-muted-foreground font-medium">{axes[hover].label}</p>
                <p className="font-medium whitespace-nowrap">{axes[hover].detail}</p>
                <p className="text-muted-foreground whitespace-nowrap">
                  {axes[hover].value === null
                    ? "no data"
                    : `${Math.round(axes[hover].value)}% of the run's best`}
                </p>
              </div>
            ),
          }}
          width={RADAR_W}
        />
      ) : null}
    </div>
  );
}

// --- heatmap (task × model) ------------------------------------------------

export interface HeatCell {
  value: number | null;
  /** Pre-formatted text drawn in the cell, so the value never lives in color alone. */
  text: string;
}

/**
 * Task-by-model grid on a single-hue ramp. Every cell also carries its value as
 * text, so the ramp is a scanning aid rather than the only encoding.
 */
export function Heatmap({
  rowLabels,
  columnLabels,
  columnColors,
  cells,
  lowerIsBetter,
  palette = SCREEN_PALETTE,
  onRowClick,
}: {
  rowLabels: string[];
  columnLabels: string[];
  columnColors: string[];
  /** `cells[row][column]`. */
  cells: HeatCell[][];
  /** Flips the ramp so the better end is always the strongest. */
  lowerIsBetter: boolean;
  palette?: VizPalette;
  onRowClick?: (rowIndex: number) => void;
}) {
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  /**
   * Cells are shaded by their *rank* within the run, not by a linear min–max
   * scale. One slow task would otherwise consume the whole ramp and flatten
   * every other cell into a single step; ranking spends the ramp evenly across
   * the grid. The exact value is printed in the cell, so the shade only ever
   * has to answer "how does this compare here?".
   */
  const sorted = [...new Set(
    cells
      .flat()
      .map((c) => c.value)
      .filter((v): v is number => v !== null),
  )].sort((a, b) => a - b);
  const rankOf = new Map(sorted.map((v, i) => [v, i]));
  const shade = (value: number | null): string => {
    if (value === null) return palette.empty;
    if (sorted.length < 2) return rampColor(1, palette);
    const t = (rankOf.get(value) ?? 0) / (sorted.length - 1);
    return rampColor(lowerIsBetter ? 1 - t : t, palette);
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate" style={{ borderSpacing: `${GAP}px` }}>
        <thead>
          <tr>
            <th className="w-40 px-1 text-left text-xs font-medium">
              <span className="text-muted-foreground">Task</span>
            </th>
            {columnLabels.map((label, ci) => (
              <th key={label} className="px-1 pb-1 text-center text-xs font-medium">
                <span className="text-muted-foreground inline-flex max-w-24 items-center gap-1">
                  <span
                    className="inline-block size-2 shrink-0 rounded-full"
                    style={{ background: columnColors[ci] }}
                  />
                  <span className="truncate">{label}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowLabels.map((label, ri) => (
            <tr key={label}>
              <td
                className={`text-muted-foreground max-w-40 truncate px-1 text-xs ${
                  onRowClick ? "cursor-pointer" : ""
                }`}
                title={label}
                onClick={() => onRowClick?.(ri)}
              >
                {label}
              </td>
              {columnLabels.map((_, ci) => {
                const cell = cells[ri]?.[ci] ?? { value: null, text: "—" };
                const active = hover?.row === ri && hover.col === ci;
                const fill = shade(cell.value);
                return (
                  <td
                    key={ci}
                    className="rounded-sm px-2 py-1.5 text-center text-xs transition-opacity"
                    style={{
                      background: fill,
                      color: cell.value === null ? "var(--muted-foreground)" : inkOn(fill, palette),
                      opacity: hover === null || active ? 1 : 0.65,
                      fontVariantNumeric: "tabular-nums",
                    }}
                    onMouseEnter={() => setHover({ row: ri, col: ci })}
                    onMouseLeave={() => setHover(null)}
                  >
                    {cell.text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Ramp key for the heatmap: which end of the scale is the good one. */
export function RampLegend({
  low,
  high,
  palette = SCREEN_PALETTE,
}: {
  low: string;
  high: string;
  palette?: VizPalette;
}) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs">
      <span>{low}</span>
      <span className="flex">
        {palette.sequential.map((color) => (
          <span
            key={color}
            className="h-2 w-5 first:rounded-l-sm last:rounded-r-sm"
            style={{ background: color }}
          />
        ))}
      </span>
      <span>{high}</span>
    </div>
  );
}

// --- dumbbell (median → tail) ----------------------------------------------

export interface RangeRow {
  label: string;
  color: string;
  from: number;
  to: number;
}

/**
 * Median-to-tail range per model: the dot pair shows both the typical value and
 * how far the bad case drifts from it. A long bar is stutter, not slowness.
 */
export function Dumbbell({
  rows,
  title,
  unit,
  fromLabel,
  toLabel,
}: {
  rows: RangeRow[];
  title: string;
  unit: string;
  fromLabel: string;
  toLabel: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const scale = buildScale(rows.flatMap((r) => [r.from, r.to]));
  const left = labelGutter(rows.map((r) => r.label));
  const right = 52;
  const plotW = Math.max(width - left - right, 40);
  const rowH = 30;
  const top = 6;
  const height = top + rows.length * rowH + 20;
  const x = (v: number) => left + ((v - scale.lo) / (scale.hi - scale.lo || 1)) * plotW;

  return (
    <div ref={ref} className="relative">
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={title}>
          {scale.ticks.map((t) => (
            <g key={t}>
              <line
                x1={x(t)}
                x2={x(t)}
                y1={top}
                y2={top + rows.length * rowH}
                className="stroke-border"
                strokeWidth={1}
                opacity={t === 0 ? 1 : 0.55}
              />
              <text
                x={x(t)}
                y={height - 6}
                textAnchor="middle"
                fontSize={10}
                className="fill-muted-foreground"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatValue(t, unit)}
              </text>
            </g>
          ))}
          {rows.map((row, ri) => {
            const cy = top + ri * rowH + rowH / 2;
            return (
              <g
                key={row.label}
                onMouseEnter={() => setHover(ri)}
                onMouseLeave={() => setHover(null)}
              >
                <text x={18} y={cy + 3.5} fontSize={10} className="fill-muted-foreground">
                  {truncate(row.label, Math.floor((left - 24) / 6.4))}
                </text>
                <circle cx={8} cy={cy} r={3.5} fill={row.color} />
                <line
                  x1={x(row.from)}
                  x2={x(row.to)}
                  y1={cy}
                  y2={cy}
                  stroke={row.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  opacity={0.45}
                />
                <circle
                  cx={x(row.from)}
                  cy={cy}
                  r={4}
                  fill={row.color}
                  style={{ stroke: SURFACE }}
                  strokeWidth={2}
                  opacity={0.6}
                />
                <circle
                  cx={x(row.to)}
                  cy={cy}
                  r={4.5}
                  fill={row.color}
                  style={{ stroke: SURFACE }}
                  strokeWidth={2}
                />
                <text
                  x={x(Math.max(row.from, row.to)) + 7}
                  y={cy + 3.5}
                  fontSize={10}
                  className="fill-foreground"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatValue(row.to, unit)}
                </text>
                <rect
                  x={0}
                  y={top + ri * rowH}
                  width={width}
                  height={rowH}
                  fill="transparent"
                />
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {hover !== null && width > 0 ? (
        <Tooltip
          tip={{
            x: x((rows[hover].from + rows[hover].to) / 2),
            y: top + hover * rowH + 2,
            content: (
              <div className="space-y-0.5">
                <p className="text-muted-foreground font-medium">{rows[hover].label}</p>
                <p className="whitespace-nowrap">
                  <span className="text-muted-foreground">{fromLabel}: </span>
                  <span className="font-medium">
                    {formatValue(rows[hover].from, unit)}
                  </span>
                </p>
                <p className="whitespace-nowrap">
                  <span className="text-muted-foreground">{toLabel}: </span>
                  <span className="font-medium">{formatValue(rows[hover].to, unit)}</span>
                </p>
              </div>
            ),
          }}
          width={width}
        />
      ) : null}
    </div>
  );
}
