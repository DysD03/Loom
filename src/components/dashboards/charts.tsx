"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import type { ChartSeries } from "@/lib/dashboard-spec";

/**
 * Categorical series palette: the app's five neon hues stepped darker for
 * chart-sized fills, validated (dataviz six-checks) against the card surface —
 * lightness band, chroma, CVD adjacent ΔE 20.6, contrast ≥ 3:1. The raw neon
 * tokens stay reserved for accents. Order is the CVD-safety mechanism: never
 * reorder or cycle past it.
 */
export const VIZ_COLORS = ["#ff2e97", "#00a2ad", "#aa8c00", "#9d6bff", "#00aa6e"];
/** Neutral for the folded "Other" slice — never a sixth hue. */
const OTHER_COLOR = "#63637f";

export function seriesColor(index: number, label?: string): string {
  if (label === "Other") return OTHER_COLOR;
  return VIZ_COLORS[index % VIZ_COLORS.length];
}

export function formatValue(value: number, unit?: string): string {
  const abs = Math.abs(value);
  const num =
    abs >= 10_000
      ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)
      : new Intl.NumberFormat("en", { maximumFractionDigits: abs < 10 ? 2 : 1 }).format(value);
  if (!unit) return num;
  if ("$€£₹".includes(unit)) {
    return value < 0 ? `-${unit}${num.slice(1)}` : `${unit}${num}`;
  }
  return unit === "%" ? `${num}%` : `${num} ${unit}`;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function niceStep(rough: number): number {
  const pow = 10 ** Math.floor(Math.log10(rough));
  const m = rough / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * pow;
}

interface Scale {
  lo: number;
  hi: number;
  ticks: number[];
}

/** Zero-anchored domain snapped to clean tick steps. */
function buildScale(values: number[]): Scale {
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (hi === lo) hi = lo + 1;
  const step = niceStep((hi - lo) / 4);
  lo = Math.floor(lo / step + 1e-9) * step;
  hi = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) {
    ticks.push(Math.abs(v) < step / 1e6 ? 0 : Math.round(v * 1e6) / 1e6);
  }
  return { lo, hi, ticks };
}

function allValues(series: ChartSeries[]): number[] {
  return series.flatMap((s) => s.data);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

/** Rounded 4px data-end, square baseline. Vertical bars. */
function barPathV(x: number, w: number, yBase: number, yEnd: number): string {
  const h = Math.abs(yBase - yEnd);
  if (h < 0.5 || w <= 0) return "";
  const r = Math.min(4, w / 2, h);
  if (yEnd <= yBase) {
    return `M${x},${yBase} L${x},${yEnd + r} Q${x},${yEnd} ${x + r},${yEnd} L${x + w - r},${yEnd} Q${x + w},${yEnd} ${x + w},${yEnd + r} L${x + w},${yBase} Z`;
  }
  return `M${x},${yBase} L${x},${yEnd - r} Q${x},${yEnd} ${x + r},${yEnd} L${x + w - r},${yEnd} Q${x + w},${yEnd} ${x + w},${yEnd - r} L${x + w},${yBase} Z`;
}

/** Rounded data-end for horizontal bars. */
function barPathH(y: number, h: number, xBase: number, xEnd: number): string {
  const w = Math.abs(xEnd - xBase);
  if (w < 0.5 || h <= 0) return "";
  const r = Math.min(4, h / 2, w);
  if (xEnd >= xBase) {
    return `M${xBase},${y} L${xEnd - r},${y} Q${xEnd},${y} ${xEnd},${y + r} L${xEnd},${y + h - r} Q${xEnd},${y + h} ${xEnd - r},${y + h} L${xBase},${y + h} Z`;
  }
  return `M${xBase},${y} L${xEnd + r},${y} Q${xEnd},${y} ${xEnd},${y + r} L${xEnd},${y + h - r} Q${xEnd},${y + h} ${xEnd + r},${y + h} L${xBase},${y + h} Z`;
}

interface TooltipState {
  x: number;
  y: number;
  content: ReactNode;
}

function Tooltip({ tip, width }: { tip: TooltipState; width: number }) {
  const left = Math.min(Math.max(tip.x, 56), Math.max(width - 56, 56));
  return (
    <div
      className="bg-popover text-popover-foreground pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded border px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left, top: Math.max(tip.y - 6, 4) }}
    >
      {tip.content}
    </div>
  );
}

function TipRows({
  heading,
  series,
  index,
  unit,
  swatch,
}: {
  heading: string;
  series: ChartSeries[];
  index: number;
  unit?: string;
  /** Overrides the swatch color (single-series charts colored per category). */
  swatch?: string;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-muted-foreground font-medium">{heading}</p>
      {series.map((s, si) => (
        <p key={s.name} className="flex items-center gap-1.5 whitespace-nowrap">
          <span
            className="inline-block size-2 rounded-full"
            style={{ background: swatch ?? seriesColor(si) }}
          />
          {series.length > 1 ? <span className="text-muted-foreground">{s.name}</span> : null}
          <span className="font-medium">{formatValue(s.data[index] ?? 0, unit)}</span>
        </p>
      ))}
    </div>
  );
}

export function ChartLegend({ series }: { series: { name: string; color: string }[] }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {series.map((s) => (
        <span key={s.name} className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

interface ChartProps {
  title: string;
  categories: string[];
  series: ChartSeries[];
  unit?: string;
  /**
   * Single-series bars only: colors bar i with categoryColors[i], so categories
   * that are entities (e.g. models compared across several charts) keep their
   * identity color. Ignored for multi-series charts.
   */
  categoryColors?: string[];
}

const PLOT_HEIGHT = 190;
const TOP = 16;
const BOTTOM = 24;

function yAxisWidth(ticks: number[], unit?: string): number {
  const longest = Math.max(...ticks.map((t) => formatValue(t, unit).length), 2);
  return Math.max(28, longest * 6.2 + 10);
}

export function BarChart(props: ChartProps) {
  const horizontal =
    props.categories.length > 10 ||
    Math.max(...props.categories.map((c) => c.length)) > 14;
  return horizontal ? <BarChartH {...props} /> : <BarChartV {...props} />;
}

function BarChartV({ title, categories, series, unit, categoryColors }: ChartProps) {
  const perCategory = series.length === 1 && categoryColors ? categoryColors : null;
  const { ref, width } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);
  const height = TOP + PLOT_HEIGHT + BOTTOM;
  const scale = buildScale(allValues(series));
  const left = yAxisWidth(scale.ticks, unit);
  const plotW = Math.max(width - left - 8, 40);
  const y = (v: number) => TOP + ((scale.hi - v) / (scale.hi - scale.lo)) * PLOT_HEIGHT;
  const n = categories.length;
  const bandW = plotW / n;
  const s = series.length;
  const barW = Math.min(24, Math.max(3, (bandW * 0.72 - (s - 1) * 2) / s));
  const groupW = s * barW + (s - 1) * 2;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 64))));
  const showTipLabels = s === 1 && n <= 8;

  return (
    <div ref={ref} className="relative">
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={title}>
          {scale.ticks.map((t) => (
            <g key={t}>
              <line
                x1={left}
                x2={left + plotW}
                y1={y(t)}
                y2={y(t)}
                className="stroke-border"
                strokeWidth={1}
                opacity={t === 0 ? 1 : 0.55}
              />
              <text
                x={left - 6}
                y={y(t) + 3}
                textAnchor="end"
                fontSize={10}
                className="fill-muted-foreground"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatValue(t, unit)}
              </text>
            </g>
          ))}
          {categories.map((cat, ci) => {
            const groupX = left + ci * bandW + (bandW - groupW) / 2;
            return (
              <g key={ci}>
                {series.map((sr, si) => (
                  <path
                    key={si}
                    d={barPathV(groupX + si * (barW + 2), barW, y(0), y(sr.data[ci] ?? 0))}
                    fill={perCategory ? perCategory[ci % perCategory.length] : seriesColor(si)}
                  />
                ))}
                {showTipLabels ? (
                  <text
                    x={groupX + groupW / 2}
                    y={
                      (series[0].data[ci] ?? 0) >= 0
                        ? y(series[0].data[ci] ?? 0) - 4
                        : y(series[0].data[ci] ?? 0) + 11
                    }
                    textAnchor="middle"
                    fontSize={10}
                    className="fill-foreground"
                  >
                    {formatValue(series[0].data[ci] ?? 0, unit)}
                  </text>
                ) : null}
                {ci % labelEvery === 0 ? (
                  <text
                    x={left + ci * bandW + bandW / 2}
                    y={TOP + PLOT_HEIGHT + 14}
                    textAnchor="middle"
                    fontSize={10}
                    className="fill-muted-foreground"
                  >
                    {truncate(cat, Math.max(4, Math.floor((bandW * labelEvery) / 6.5)))}
                  </text>
                ) : null}
                <rect
                  x={left + ci * bandW}
                  y={TOP}
                  width={bandW}
                  height={PLOT_HEIGHT}
                  fill="transparent"
                  onMouseEnter={() =>
                    setTip({
                      x: left + ci * bandW + bandW / 2,
                      y: TOP + 4,
                      content: (
                        <TipRows
                          heading={cat}
                          series={series}
                          index={ci}
                          unit={unit}
                          swatch={perCategory?.[ci % perCategory.length]}
                        />
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

function BarChartH({ title, categories, series, unit, categoryColors }: ChartProps) {
  const perCategory = series.length === 1 && categoryColors ? categoryColors : null;
  const { ref, width } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);
  const scale = buildScale(allValues(series));
  const maxLabel = Math.max(...categories.map((c) => c.length));
  const left = Math.min(150, Math.max(56, maxLabel * 6.4 + 10));
  const right = 44;
  const plotW = Math.max(width - left - right, 40);
  const s = series.length;
  const barH = Math.min(16, Math.max(4, 40 / s));
  const rowH = s * barH + (s - 1) * 2 + 10;
  const top = 6;
  const bottom = 20;
  const height = top + categories.length * rowH + bottom;
  const x = (v: number) => left + ((v - scale.lo) / (scale.hi - scale.lo)) * plotW;

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
                y2={top + categories.length * rowH}
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
          {categories.map((cat, ci) => {
            const rowY = top + ci * rowH + 5;
            return (
              <g key={ci}>
                <text
                  x={left - 8}
                  y={rowY + (s * barH + (s - 1) * 2) / 2 + 3}
                  textAnchor="end"
                  fontSize={10}
                  className="fill-muted-foreground"
                >
                  {truncate(cat, Math.floor(left / 6.4))}
                </text>
                {series.map((sr, si) => {
                  const value = sr.data[ci] ?? 0;
                  return (
                    <path
                      key={si}
                      d={barPathH(rowY + si * (barH + 2), barH, x(0), x(value))}
                      fill={perCategory ? perCategory[ci % perCategory.length] : seriesColor(si)}
                    />
                  );
                })}
                {s === 1 ? (
                  <text
                    x={x(Math.max(series[0].data[ci] ?? 0, 0)) + 5}
                    y={rowY + barH / 2 + 3}
                    fontSize={10}
                    className="fill-foreground"
                  >
                    {formatValue(series[0].data[ci] ?? 0, unit)}
                  </text>
                ) : null}
                <rect
                  x={0}
                  y={top + ci * rowH}
                  width={Math.max(width, 0)}
                  height={rowH}
                  fill="transparent"
                  onMouseEnter={() =>
                    setTip({
                      x: left + plotW / 2,
                      y: top + ci * rowH + 6,
                      content: (
                        <TipRows
                          heading={cat}
                          series={series}
                          index={ci}
                          unit={unit}
                          swatch={perCategory?.[ci % perCategory.length]}
                        />
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

export function LineChart({
  title,
  categories,
  series,
  unit,
  area = false,
}: ChartProps & { area?: boolean }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const height = TOP + PLOT_HEIGHT + BOTTOM;
  const scale = buildScale(allValues(series));
  const left = yAxisWidth(scale.ticks, unit);
  const endLabel = series.length === 1;
  const right = endLabel ? 48 : 12;
  const plotW = Math.max(width - left - right, 40);
  const n = categories.length;
  const stepX = n > 1 ? plotW / (n - 1) : 0;
  const px = (i: number) => (n > 1 ? left + i * stepX : left + plotW / 2);
  const y = (v: number) => TOP + ((scale.hi - v) / (scale.hi - scale.lo)) * PLOT_HEIGHT;
  const yZero = y(Math.max(scale.lo, Math.min(0, scale.hi)));
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 72))));

  return (
    <div ref={ref} className="relative">
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={title}>
          {scale.ticks.map((t) => (
            <g key={t}>
              <line
                x1={left}
                x2={left + plotW}
                y1={y(t)}
                y2={y(t)}
                className="stroke-border"
                strokeWidth={1}
                opacity={t === 0 ? 1 : 0.55}
              />
              <text
                x={left - 6}
                y={y(t) + 3}
                textAnchor="end"
                fontSize={10}
                className="fill-muted-foreground"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatValue(t, unit)}
              </text>
            </g>
          ))}
          {categories.map((cat, ci) =>
            ci % labelEvery === 0 || ci === n - 1 ? (
              <text
                key={ci}
                x={px(ci)}
                y={TOP + PLOT_HEIGHT + 14}
                textAnchor="middle"
                fontSize={10}
                className="fill-muted-foreground"
              >
                {truncate(cat, 10)}
              </text>
            ) : null,
          )}
          {hoverIndex !== null ? (
            <line
              x1={px(hoverIndex)}
              x2={px(hoverIndex)}
              y1={TOP}
              y2={TOP + PLOT_HEIGHT}
              className="stroke-border"
              strokeWidth={1}
            />
          ) : null}
          {series.map((sr, si) => {
            const points = sr.data.map((v, i) => `${px(i)},${y(v)}`).join(" L");
            const color = seriesColor(si);
            const last = sr.data.length - 1;
            return (
              <g key={si}>
                {area ? (
                  <path
                    d={`M${px(0)},${yZero} L${points} L${px(last)},${yZero} Z`}
                    fill={color}
                    opacity={0.1}
                  />
                ) : null}
                <path
                  d={`M${points}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <circle
                  cx={px(last)}
                  cy={y(sr.data[last] ?? 0)}
                  r={4}
                  fill={color}
                  style={{ stroke: "var(--card)" }}
                  strokeWidth={2}
                />
                {endLabel ? (
                  <text
                    x={px(last) + 8}
                    y={y(sr.data[last] ?? 0) + 3}
                    fontSize={10}
                    className="fill-foreground"
                  >
                    {formatValue(sr.data[last] ?? 0, unit)}
                  </text>
                ) : null}
                {hoverIndex !== null ? (
                  <circle
                    cx={px(hoverIndex)}
                    cy={y(sr.data[hoverIndex] ?? 0)}
                    r={4}
                    fill={color}
                    style={{ stroke: "var(--card)" }}
                    strokeWidth={2}
                  />
                ) : null}
              </g>
            );
          })}
          <rect
            x={left}
            y={TOP}
            width={plotW}
            height={PLOT_HEIGHT}
            fill="transparent"
            onMouseMove={(e) => {
              const bounds = e.currentTarget.getBoundingClientRect();
              const xIn = e.clientX - bounds.left;
              const index = n > 1 ? Math.round(xIn / stepX) : 0;
              setHoverIndex(Math.min(Math.max(index, 0), n - 1));
            }}
            onMouseLeave={() => setHoverIndex(null)}
          />
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {hoverIndex !== null && width > 0 ? (
        <Tooltip
          tip={{
            x: px(hoverIndex),
            y: TOP + 2,
            content: (
              <TipRows
                heading={categories[hoverIndex]}
                series={series}
                index={hoverIndex}
                unit={unit}
              />
            ),
          }}
          width={width}
        />
      ) : null}
    </div>
  );
}

function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0o = cx + r1 * Math.cos(a0);
  const y0o = cy + r1 * Math.sin(a0);
  const x1o = cx + r1 * Math.cos(a1);
  const y1o = cy + r1 * Math.sin(a1);
  const x0i = cx + r0 * Math.cos(a1);
  const y0i = cy + r0 * Math.sin(a1);
  const x1i = cx + r0 * Math.cos(a0);
  const y1i = cy + r0 * Math.sin(a0);
  return `M${x0o},${y0o} A${r1},${r1} 0 ${large} 1 ${x1o},${y1o} L${x0i},${y0i} A${r0},${r0} 0 ${large} 0 ${x1i},${y1i} Z`;
}

export function DonutChart({ title, categories, series, unit }: ChartProps) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const data = series[0]?.data ?? [];
  const total = data.reduce((sum, v) => sum + Math.max(v, 0), 0);
  const size = 176;
  const cx = size / 2;
  const cy = size / 2;

  if (total <= 0) return null;

  const values = categories.map((_, i) => Math.max(data[i] ?? 0, 0));
  const slices = categories.map((label, i) => {
    const before = values.slice(0, i).reduce((sum, v) => sum + v, 0);
    const a0 = -Math.PI / 2 + (before / total) * Math.PI * 2;
    return { label, value: values[i], a0, a1: a0 + (values[i] / total) * Math.PI * 2, index: i };
  });

  return (
    <div ref={ref} className="relative flex flex-wrap items-center gap-x-6 gap-y-3">
      <svg width={size} height={size} role="img" aria-label={title} className="shrink-0">
        {slices.length === 1 ? (
          <circle
            cx={cx}
            cy={cy}
            r={(70 + 46) / 2}
            fill="none"
            stroke={seriesColor(0, slices[0].label)}
            strokeWidth={70 - 46}
          />
        ) : (
          slices.map((slice) => (
            <path
              key={slice.index}
              d={arcPath(cx, cy, 46, 70, slice.a0, slice.a1)}
              fill={seriesColor(slice.index, slice.label)}
              style={{ stroke: "var(--card)" }}
              strokeWidth={2}
              opacity={hover === null || hover === slice.index ? 1 : 0.45}
              onMouseEnter={() => setHover(slice.index)}
              onMouseLeave={() => setHover(null)}
            />
          ))
        )}
        <text x={cx} y={cy - 1} textAnchor="middle" fontSize={17} fontWeight={600} className="fill-foreground">
          {formatValue(total, unit)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize={10} className="fill-muted-foreground">
          Total
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((slice) => (
          <li
            key={slice.index}
            className="flex items-center gap-2 text-xs"
            onMouseEnter={() => setHover(slice.index)}
            onMouseLeave={() => setHover(null)}
          >
            <span
              className="inline-block size-2 shrink-0 rounded-full"
              style={{ background: seriesColor(slice.index, slice.label) }}
            />
            <span className="text-muted-foreground min-w-0 flex-1 truncate">{slice.label}</span>
            <span className="font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatValue(slice.value, unit)}
            </span>
            <span className="text-muted-foreground w-10 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
              {((slice.value / total) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
      {hover !== null && width > 0 ? (
        <Tooltip
          tip={{
            x: cx,
            y: 16,
            content: (
              <p className="whitespace-nowrap">
                <span className="text-muted-foreground">{slices[hover].label}: </span>
                <span className="font-medium">{formatValue(slices[hover].value, unit)}</span>
              </p>
            ),
          }}
          width={width}
        />
      ) : null}
    </div>
  );
}
