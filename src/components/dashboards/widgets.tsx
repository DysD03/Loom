"use client";

import { useState } from "react";
import {
  ChartColumn,
  CircleCheckBig,
  Info,
  OctagonAlert,
  Table2,
  TriangleAlert,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Markdown } from "@/components/markdown";
import {
  BarChart,
  ChartLegend,
  DonutChart,
  formatValue,
  LineChart,
  seriesColor,
} from "./charts";
import type {
  CalloutWidget,
  ChartWidget,
  DashboardSpec,
  ListWidget,
  ProgressWidget,
  QuoteWidget,
  StatWidget,
  TableWidget,
  TextWidget,
  Widget,
  WidgetSize,
} from "@/lib/dashboard-spec";

/** Grid spans per size on the 12-column section grid. */
const SIZE_CLASS: Record<WidgetSize, string> = {
  sm: "col-span-6 md:col-span-3 xl:col-span-3",
  md: "col-span-12 md:col-span-6 xl:col-span-4",
  lg: "col-span-12 xl:col-span-6",
  full: "col-span-12",
};

const DEFAULT_SIZE: Record<Widget["type"], WidgetSize> = {
  stat: "sm",
  progress: "sm",
  quote: "md",
  list: "md",
  chart: "lg",
  table: "lg",
  callout: "lg",
  text: "lg",
};

function WidgetCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("bg-card/80 min-w-0 rounded-lg border p-4", className)}>{children}</div>
  );
}

function WidgetTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-medium">{children}</h3>;
}

function Stat({ widget }: { widget: StatWidget }) {
  const direction =
    widget.direction ?? (widget.delta ? (/^[-↓]/.test(widget.delta) ? "down" : "up") : undefined);
  return (
    <WidgetCard className="flex h-full flex-col justify-between gap-2">
      <p className="text-muted-foreground text-xs">{widget.label}</p>
      <div>
        <p className="text-2xl font-semibold tracking-tight break-words">{widget.value}</p>
        {widget.delta ? (
          <p
            className={cn(
              "mt-1 text-xs",
              direction === "up" && "text-neon-green",
              direction === "down" && "text-destructive",
              direction === "flat" && "text-muted-foreground",
            )}
          >
            {direction === "up" ? "▲ " : direction === "down" ? "▼ " : ""}
            {widget.delta}
          </p>
        ) : null}
        {widget.note ? <p className="text-muted-foreground mt-1 text-xs">{widget.note}</p> : null}
      </div>
    </WidgetCard>
  );
}

function numericColumns(widget: TableWidget): boolean[] {
  return widget.columns.map((_, c) => {
    const cells = widget.rows.map((r) => r[c] ?? "").filter(Boolean);
    if (cells.length === 0) return false;
    return cells.filter((cell) => /^[\s$€£₹+(-]*[\d.,]+\s*[%kKmMbB)]*\s*$/.test(cell)).length >= cells.length * 0.7;
  });
}

function DataTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  const numeric = numericColumns({ type: "table", columns, rows });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            {columns.map((col, c) => (
              <th
                key={c}
                className={cn(
                  "text-muted-foreground px-2 py-1.5 text-xs font-medium tracking-wide",
                  numeric[c] ? "text-right" : "text-left",
                )}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-border/50 border-b last:border-0">
              {columns.map((_, c) => (
                <td
                  key={c}
                  className={cn("px-2 py-1.5", numeric[c] && "text-right")}
                  style={numeric[c] ? { fontVariantNumeric: "tabular-nums" } : undefined}
                >
                  {row[c] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Chart card with a legend (≥2 series) and a chart ⇄ table twin toggle. */
function Chart({ widget }: { widget: ChartWidget }) {
  const [showTable, setShowTable] = useState(false);
  const multi = widget.series.length > 1;

  const table = (
    <DataTable
      columns={["", ...widget.series.map((s) => s.name)]}
      rows={widget.categories.map((cat, i) => [
        cat,
        ...widget.series.map((s) => formatValue(s.data[i] ?? 0, widget.unit)),
      ])}
    />
  );

  return (
    <WidgetCard>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1.5">
          <WidgetTitle>{widget.title}</WidgetTitle>
          {multi ? (
            <ChartLegend
              series={widget.series.map((s, i) => ({ name: s.name, color: seriesColor(i) }))}
            />
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-label={showTable ? "Show chart" : "Show as table"}
          title={showTable ? "Show chart" : "Show as table"}
          className="text-muted-foreground hover:bg-accent hover:text-accent-foreground shrink-0 rounded p-1 transition-colors"
        >
          {showTable ? <ChartColumn className="size-4" /> : <Table2 className="size-4" />}
        </button>
      </div>
      {showTable ? (
        table
      ) : widget.chartType === "donut" ? (
        <DonutChart {...widget} />
      ) : widget.chartType === "bar" ? (
        <BarChart {...widget} />
      ) : (
        <LineChart {...widget} area={widget.chartType === "area"} />
      )}
    </WidgetCard>
  );
}

function TableCard({ widget }: { widget: TableWidget }) {
  return (
    <WidgetCard>
      {widget.title ? (
        <div className="mb-3">
          <WidgetTitle>{widget.title}</WidgetTitle>
        </div>
      ) : null}
      <DataTable columns={widget.columns} rows={widget.rows} />
    </WidgetCard>
  );
}

function List({ widget }: { widget: ListWidget }) {
  const checklist = widget.items.some((i) => i.done !== undefined);
  return (
    <WidgetCard>
      {widget.title ? (
        <div className="mb-2">
          <WidgetTitle>{widget.title}</WidgetTitle>
        </div>
      ) : null}
      {checklist ? (
        <ul className="space-y-1.5 text-sm">
          {widget.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              {item.done ? (
                <CircleCheckBig className="text-neon-green mt-0.5 size-3.5 shrink-0" />
              ) : (
                <span className="border-muted-foreground/60 mt-1 size-3 shrink-0 rounded-[3px] border" />
              )}
              <span className={cn(item.done && "text-muted-foreground line-through")}>
                {item.text}
              </span>
            </li>
          ))}
        </ul>
      ) : widget.ordered ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {widget.items.map((item, i) => (
            <li key={i}>{item.text}</li>
          ))}
        </ol>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {widget.items.map((item, i) => (
            <li key={i}>{item.text}</li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function Progress({ widget }: { widget: ProgressWidget }) {
  const max = widget.max && widget.max > 0 ? widget.max : 100;
  const ratio = Math.min(Math.max(widget.value / max, 0), 1);
  // Meter: fill + same-hue lighter track so the state reads across the bar.
  const fill = "#00a2ad";
  return (
    <WidgetCard className="flex h-full flex-col justify-between gap-3">
      <p className="text-muted-foreground text-xs">{widget.label}</p>
      <div>
        <p className="text-lg font-semibold tracking-tight">
          {formatValue(widget.value, widget.unit)}
          <span className="text-muted-foreground text-xs font-normal">
            {" "}
            / {formatValue(max, widget.unit)}
          </span>
        </p>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full"
          style={{ background: `color-mix(in oklch, ${fill}, transparent 82%)` }}
          role="meter"
          aria-valuenow={widget.value}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-label={widget.label}
        >
          <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, background: fill }} />
        </div>
      </div>
    </WidgetCard>
  );
}

const TONE_STYLES = {
  info: { border: "border-l-neon-cyan", icon: Info, iconClass: "text-neon-cyan" },
  success: { border: "border-l-neon-green", icon: CircleCheckBig, iconClass: "text-neon-green" },
  warning: { border: "border-l-neon-yellow", icon: TriangleAlert, iconClass: "text-neon-yellow" },
  danger: { border: "border-l-destructive", icon: OctagonAlert, iconClass: "text-destructive" },
} as const;

function Callout({ widget }: { widget: CalloutWidget }) {
  const tone = TONE_STYLES[widget.tone];
  const Icon = tone.icon;
  return (
    <WidgetCard className={cn("border-l-2", tone.border)}>
      <div className="flex items-start gap-2.5">
        <Icon className={cn("mt-0.5 size-4 shrink-0", tone.iconClass)} />
        <div className="min-w-0 space-y-1">
          {widget.title ? <WidgetTitle>{widget.title}</WidgetTitle> : null}
          <p className="text-muted-foreground text-sm">{widget.text}</p>
        </div>
      </div>
    </WidgetCard>
  );
}

function Text({ widget }: { widget: TextWidget }) {
  return (
    <WidgetCard>
      {widget.title ? (
        <div className="mb-2">
          <WidgetTitle>{widget.title}</WidgetTitle>
        </div>
      ) : null}
      <Markdown>{widget.markdown}</Markdown>
    </WidgetCard>
  );
}

function BlockQuote({ widget }: { widget: QuoteWidget }) {
  return (
    <WidgetCard className="flex h-full flex-col justify-center">
      <blockquote className="border-neon-magenta border-l-2 pl-3">
        <p className="text-muted-foreground text-sm italic">{widget.text}</p>
        {widget.attribution ? (
          <footer className="text-muted-foreground/80 mt-1.5 text-xs">— {widget.attribution}</footer>
        ) : null}
      </blockquote>
    </WidgetCard>
  );
}

function WidgetView({ widget }: { widget: Widget }) {
  switch (widget.type) {
    case "stat":
      return <Stat widget={widget} />;
    case "chart":
      return <Chart widget={widget} />;
    case "table":
      return <TableCard widget={widget} />;
    case "list":
      return <List widget={widget} />;
    case "progress":
      return <Progress widget={widget} />;
    case "callout":
      return <Callout widget={widget} />;
    case "text":
      return <Text widget={widget} />;
    case "quote":
      return <BlockQuote widget={widget} />;
  }
}

export function DashboardRenderer({ spec }: { spec: DashboardSpec }) {
  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{spec.title}</h1>
        {spec.subtitle ? <p className="text-muted-foreground text-sm">{spec.subtitle}</p> : null}
      </header>
      {spec.sections.map((section, si) => (
        <section key={si} className="space-y-3">
          {section.title ? (
            <h2 className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
              <span className="bg-neon-cyan mr-2 inline-block h-2.5 w-0.5 align-[-1px]" />
              {section.title}
            </h2>
          ) : null}
          <div className="grid grid-cols-12 gap-3">
            {section.widgets.map((widget, wi) => (
              <div key={wi} className={SIZE_CLASS[widget.size ?? DEFAULT_SIZE[widget.type]]}>
                <WidgetView widget={widget} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
