/**
 * The dashboard spec: a structured description of a dashboard that the native
 * renderer (`src/components/dashboards`) draws. Produced by the LLM (see
 * `dashboards.ts`) or, when the model is unreachable, by the deterministic
 * Markdown parser in this file. Shared by server and client, so no zod and no
 * server-only imports here.
 */

export type WidgetSize = "sm" | "md" | "lg" | "full";

export interface StatWidget {
  type: "stat";
  label: string;
  value: string;
  delta?: string;
  direction?: "up" | "down" | "flat";
  note?: string;
}

export type ChartType = "bar" | "line" | "area" | "donut";

export interface ChartSeries {
  name: string;
  data: number[];
}

export interface ChartWidget {
  type: "chart";
  chartType: ChartType;
  title: string;
  /** X labels (bar/line/area) or slice labels (donut). */
  categories: string[];
  series: ChartSeries[];
  /** "$" prefixes values; anything else ("%", "ms", …) suffixes them. */
  unit?: string;
}

export interface TableWidget {
  type: "table";
  title?: string;
  columns: string[];
  rows: string[][];
}

export interface ListItem {
  text: string;
  /** Set for checklist items ("- [x] …"). */
  done?: boolean;
}

export interface ListWidget {
  type: "list";
  title?: string;
  items: ListItem[];
  ordered?: boolean;
}

export interface ProgressWidget {
  type: "progress";
  label: string;
  value: number;
  max?: number;
  unit?: string;
}

export type CalloutTone = "info" | "success" | "warning" | "danger";

export interface CalloutWidget {
  type: "callout";
  tone: CalloutTone;
  title?: string;
  text: string;
}

export interface TextWidget {
  type: "text";
  title?: string;
  markdown: string;
}

export interface QuoteWidget {
  type: "quote";
  text: string;
  attribution?: string;
}

export type Widget = (
  | StatWidget
  | ChartWidget
  | TableWidget
  | ListWidget
  | ProgressWidget
  | CalloutWidget
  | TextWidget
  | QuoteWidget
) & { size?: WidgetSize };

export interface DashboardSection {
  title?: string;
  widgets: Widget[];
}

export interface DashboardSpec {
  title: string;
  subtitle?: string;
  sections: DashboardSection[];
}

const MAX_SECTIONS = 12;
const MAX_WIDGETS_PER_SECTION = 16;
const MAX_CATEGORIES = 24;
const MAX_SERIES = 4;
/** A donut keeps its 5 largest slices; the tail folds into "Other" (slot 6, gray). */
const MAX_DONUT_SLICES = 5;
const MAX_TABLE_ROWS = 60;
const MAX_LIST_ITEMS = 24;
const TEXT_WIDGET_MAX = 2_400;

/**
 * Parses a human-formatted number: "$1,284", "42k", "97 %", "(3.2)" (negative),
 * "+18". Returns null when the string is not a lone number.
 */
export function parseNumber(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/^\((.*)\)$/, "-$1")
    .replace(/[$€£₹,\s]/g, "")
    .replace(/%$/, "")
    .replace(/^\+/, "");
  const match = cleaned.match(/^(-?\d+(?:\.\d+)?)([kKmMbB])?$/);
  if (!match) {
    return null;
  }
  const base = Number(match[1]);
  const suffix = match[2]?.toLowerCase();
  const factor = suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : suffix === "b" ? 1e9 : 1;
  return base * factor;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asOptString(value: unknown): string | undefined {
  const s = asString(value);
  return s ? s : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString);
}

/** Coerces a spec value to a finite number, accepting formatted strings ("$1.2k"). */
function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return parseNumber(value);
  return null;
}

function asSize(value: unknown): WidgetSize | undefined {
  return value === "sm" || value === "md" || value === "lg" || value === "full"
    ? value
    : undefined;
}

const CHECKBOX = /^\[([ xX])\]\s*/;

function asListItem(value: unknown): ListItem | null {
  if (typeof value === "string") {
    const checkbox = value.match(CHECKBOX);
    const text = value.replace(CHECKBOX, "").trim();
    if (!text) return null;
    return checkbox ? { text, done: checkbox[1] !== " " } : { text };
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const text = asString(obj.text ?? obj.label ?? obj.item);
    if (!text) return null;
    const item: ListItem = { text };
    if (typeof obj.done === "boolean") item.done = obj.done;
    return item;
  }
  return null;
}

interface RawSeries {
  name: string;
  data: number[];
}

/**
 * Reads chart series out of model output, tolerating both the documented shape
 * ({categories, series}) and the common alternative ({data: [{label, value}]}).
 */
function readChartData(obj: Record<string, unknown>): {
  categories: string[];
  series: RawSeries[];
} {
  const categories = asStringArray(obj.categories ?? obj.labels);
  const seriesRaw = Array.isArray(obj.series) ? obj.series : [];
  const series: RawSeries[] = [];
  for (const entry of seriesRaw) {
    if (!entry || typeof entry !== "object") continue;
    const s = entry as Record<string, unknown>;
    const data = Array.isArray(s.data ?? s.values)
      ? ((s.data ?? s.values) as unknown[]).map((v) => asNumber(v) ?? 0)
      : [];
    if (data.some((v) => v !== 0) || data.length > 0) {
      series.push({ name: asString(s.name ?? s.label) || `Series ${series.length + 1}`, data });
    }
  }
  if (categories.length > 0 && series.length > 0) {
    return { categories, series };
  }

  // Alternative point-list shape: data: [{label, value}, …]
  const points = Array.isArray(obj.data) ? obj.data : [];
  const labels: string[] = [];
  const values: number[] = [];
  for (const point of points) {
    if (!point || typeof point !== "object") continue;
    const p = point as Record<string, unknown>;
    const label = asString(p.label ?? p.name ?? p.category ?? p.x);
    const value = asNumber(p.value ?? p.y ?? p.count);
    if (label && value !== null) {
      labels.push(label);
      values.push(value);
    }
  }
  if (labels.length > 0) {
    return { categories: labels, series: [{ name: "Value", data: values }] };
  }
  return { categories, series };
}

/** Keeps the largest slices and folds the rest into "Other". */
function foldDonut(categories: string[], data: number[]): { categories: string[]; data: number[] } {
  const pairs = categories
    .map((label, i) => ({ label, value: data[i] ?? 0 }))
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value);
  if (pairs.length <= MAX_DONUT_SLICES + 1) {
    return { categories: pairs.map((p) => p.label), data: pairs.map((p) => p.value) };
  }
  const kept = pairs.slice(0, MAX_DONUT_SLICES);
  const other = pairs.slice(MAX_DONUT_SLICES).reduce((sum, p) => sum + p.value, 0);
  return {
    categories: [...kept.map((p) => p.label), "Other"],
    data: [...kept.map((p) => p.value), other],
  };
}

function normalizeChart(obj: Record<string, unknown>): Widget | null {
  const rawType = asString(obj.chartType).toLowerCase();
  const chartType: ChartType =
    rawType === "line" || rawType === "area" || rawType === "donut"
      ? rawType
      : rawType === "pie"
        ? "donut"
        : "bar";
  const { categories, series } = readChartData(obj);
  const trimmedCategories = categories.slice(0, MAX_CATEGORIES).map((c) => c || "—");
  const cleanSeries = series
    .slice(0, MAX_SERIES)
    .map((s) => ({
      name: s.name,
      data: trimmedCategories.map((_, i) => {
        const v = s.data[i];
        return typeof v === "number" && Number.isFinite(v) ? v : 0;
      }),
    }))
    .filter((s) => s.data.some((v) => v !== 0));
  if (trimmedCategories.length === 0 || cleanSeries.length === 0) {
    return null;
  }

  const title = asString(obj.title) || "Chart";
  const unit = asOptString(obj.unit);

  // A one-point chart is a number, not a chart.
  if (trimmedCategories.length === 1 && cleanSeries.length === 1) {
    return {
      type: "stat",
      label: title,
      value: formatStatValue(cleanSeries[0].data[0], unit),
      size: "sm",
    };
  }

  if (chartType === "donut") {
    const folded = foldDonut(trimmedCategories, cleanSeries[0].data);
    if (folded.categories.length < 2) {
      return null;
    }
    return {
      type: "chart",
      chartType,
      title,
      categories: folded.categories,
      series: [{ name: cleanSeries[0].name, data: folded.data }],
      unit,
      size: asSize(obj.size),
    };
  }

  return {
    type: "chart",
    chartType,
    title,
    categories: trimmedCategories,
    series: cleanSeries,
    unit,
    size: asSize(obj.size),
  };
}

function formatStatValue(value: number, unit?: string): string {
  const compact =
    Math.abs(value) >= 10_000
      ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)
      : new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
  if (!unit) return compact;
  return unit === "$" ? `$${compact}` : `${compact}${unit === "%" ? "%" : ` ${unit}`}`;
}

function normalizeWidget(value: unknown): Widget | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const type = asString(obj.type).toLowerCase();
  const size = asSize(obj.size);

  if (type === "stat" || type === "kpi" || type === "metric") {
    const label = asString(obj.label ?? obj.title);
    const statValue = asString(obj.value);
    if (!label || !statValue) return null;
    const direction = asString(obj.direction).toLowerCase();
    return {
      type: "stat",
      label,
      value: statValue.slice(0, 24),
      delta: asOptString(obj.delta),
      direction:
        direction === "up" || direction === "down" || direction === "flat"
          ? direction
          : undefined,
      note: asOptString(obj.note),
      size,
    };
  }

  if (type === "chart" || type === "bar" || type === "line" || type === "area" || type === "pie" || type === "donut") {
    // Models sometimes put the chart kind in `type` directly.
    if (type !== "chart" && !obj.chartType) obj.chartType = type;
    return normalizeChart(obj);
  }

  if (type === "table") {
    const columns = asStringArray(obj.columns ?? obj.headers).filter(Boolean);
    const rowsRaw = Array.isArray(obj.rows) ? obj.rows : [];
    if (columns.length === 0 || rowsRaw.length === 0) return null;
    const rows = rowsRaw
      .slice(0, MAX_TABLE_ROWS)
      .map((row) =>
        Array.isArray(row)
          ? columns.map((_, i) => asString(row[i]))
          : columns.map(() => ""),
      )
      .filter((row) => row.some(Boolean));
    if (rows.length === 0) return null;
    return { type: "table", title: asOptString(obj.title), columns, rows, size };
  }

  if (type === "list" || type === "checklist") {
    const items = (Array.isArray(obj.items) ? obj.items : [])
      .map(asListItem)
      .filter((i): i is ListItem => i !== null)
      .slice(0, MAX_LIST_ITEMS);
    if (items.length === 0) return null;
    return {
      type: "list",
      title: asOptString(obj.title),
      items,
      ordered: obj.ordered === true,
      size,
    };
  }

  if (type === "progress" || type === "meter" || type === "gauge") {
    const label = asString(obj.label ?? obj.title);
    const progressValue = asNumber(obj.value);
    if (!label || progressValue === null) return null;
    const max = asNumber(obj.max);
    return {
      type: "progress",
      label,
      value: progressValue,
      max: max !== null && max > 0 ? max : undefined,
      unit: asOptString(obj.unit),
      size,
    };
  }

  if (type === "callout" || type === "alert" || type === "note") {
    const text = asString(obj.text ?? obj.markdown ?? obj.content);
    if (!text) return null;
    const tone = asString(obj.tone).toLowerCase();
    return {
      type: "callout",
      tone:
        tone === "success" || tone === "warning" || tone === "danger"
          ? tone
          : tone === "error" || tone === "critical"
            ? "danger"
            : "info",
      title: asOptString(obj.title),
      text: text.slice(0, 800),
      size,
    };
  }

  if (type === "quote") {
    const text = asString(obj.text);
    if (!text) return null;
    return { type: "quote", text: text.slice(0, 600), attribution: asOptString(obj.attribution), size };
  }

  // "text" and anything unrecognized that still carries prose.
  const markdown = asString(obj.markdown ?? obj.text ?? obj.content);
  if (!markdown) return null;
  return {
    type: "text",
    title: asOptString(obj.title),
    markdown: markdown.slice(0, TEXT_WIDGET_MAX),
    size,
  };
}

/**
 * Tolerantly coerces model output (or stored JSON) into a valid DashboardSpec,
 * dropping anything unusable. Returns null when nothing renderable survives.
 */
export function normalizeSpec(input: unknown): DashboardSpec | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  // Some models return a bare widget array; wrap it in one section.
  const sectionsRaw = Array.isArray(raw.sections)
    ? raw.sections
    : Array.isArray(raw.widgets)
      ? [{ widgets: raw.widgets }]
      : null;
  if (!sectionsRaw) return null;

  const sections: DashboardSection[] = [];
  for (const entry of sectionsRaw.slice(0, MAX_SECTIONS)) {
    if (!entry || typeof entry !== "object") continue;
    const section = entry as Record<string, unknown>;
    const widgets = (Array.isArray(section.widgets) ? section.widgets : [])
      .map(normalizeWidget)
      .filter((w): w is Widget => w !== null)
      .slice(0, MAX_WIDGETS_PER_SECTION);
    if (widgets.length > 0) {
      sections.push({ title: asOptString(section.title), widgets });
    }
  }
  if (sections.length === 0) return null;

  return {
    title: asString(raw.title) || "Dashboard",
    subtitle: asOptString(raw.subtitle),
    sections,
  };
}

/** Returns the first `# h1` line of a Markdown document, if any. */
export function extractMarkdownTitle(markdown: string): string | undefined {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1].trim() || undefined;
}

// --- Deterministic Markdown → spec (the no-model fallback) ---

interface ParsedTable {
  columns: string[];
  rows: string[][];
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c) || /^:-:?$/.test(c));
}

const TIMEISH =
  /^((19|20)\d{2}|q[1-4]\b|w(eek)?\s?\d|day\s?\d|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\d{1,2}[/.-]\d{1,2})/i;

function detectUnit(cells: string[]): string | undefined {
  const nonEmpty = cells.filter(Boolean);
  if (nonEmpty.length === 0) return undefined;
  const pct = nonEmpty.filter((c) => /%\s*$/.test(c)).length;
  if (pct / nonEmpty.length >= 0.7) return "%";
  const currency = nonEmpty.map((c) => c.trim().match(/^([$€£₹])/)).filter(Boolean);
  if (currency.length / nonEmpty.length >= 0.7) return currency[0]![1];
  return undefined;
}

/** Extracts a trailing parenthesized delta: "42k (+18%)" → value "42k", delta "+18%". */
function splitDelta(value: string): { value: string; delta?: string; direction?: "up" | "down" } {
  const match = value.match(/^(.*?)\s*\(([+↑↓-].{0,12}?)\)$/);
  if (!match) return { value };
  const delta = match[2];
  return {
    value: match[1].trim(),
    delta,
    direction: /^[-↓]/.test(delta) ? "down" : "up",
  };
}

function tableToWidgets(table: ParsedTable): Widget[] {
  const { columns, rows } = table;
  if (columns.length < 2 || rows.length === 0) {
    return [{ type: "table", columns, rows }];
  }

  const numericColumns: number[] = [];
  for (let c = 1; c < columns.length; c++) {
    const cells = rows.map((r) => r[c] ?? "");
    const parsed = cells.filter((cell) => cell && parseNumber(cell) !== null);
    if (parsed.length >= rows.length * 0.7) {
      numericColumns.push(c);
    }
  }

  // A short "Metric | Value" table with mixed units reads as a KPI row, not a chart.
  if (columns.length === 2 && numericColumns.length === 1 && rows.length >= 2 && rows.length <= 8) {
    const units = new Set(rows.map((r) => detectUnit([r[1]]) ?? ""));
    const headerHint = /metric|kpi|measure|stat|indicator/i.test(columns[0]);
    if (headerHint || units.size > 1) {
      return rows.map((r) => {
        const { value, delta, direction } = splitDelta(r[1] ?? "");
        return { type: "stat", label: r[0] ?? "", value, delta, direction, size: "sm" };
      });
    }
  }

  const mostlyNumeric = numericColumns.length / (columns.length - 1) >= 0.5;
  if (numericColumns.length === 0 || !mostlyNumeric || rows.length < 2 || rows.length > 30) {
    return [
      {
        type: "table",
        columns,
        rows: rows.slice(0, MAX_TABLE_ROWS),
        size: columns.length > 4 ? "full" : "lg",
      },
    ];
  }

  const categories = rows.map((r) => r[0] ?? "—");
  const series = numericColumns.slice(0, MAX_SERIES).map((c) => ({
    name: columns[c],
    data: rows.map((r) => parseNumber(r[c] ?? "") ?? 0),
  }));
  const timeish = categories.filter((c) => TIMEISH.test(c)).length >= categories.length * 0.6;
  const unit = detectUnit(rows.map((r) => r[numericColumns[0]] ?? ""));

  return [
    {
      type: "chart",
      chartType: timeish ? "line" : "bar",
      title: numericColumns.slice(0, MAX_SERIES).map((c) => columns[c]).join(" / ") || "Data",
      categories,
      series,
      unit,
      size: "lg",
    },
  ];
}

const STAT_LINE = /^\*{0,2}([^:*]{1,48}?)\*{0,2}\s*:\s*\*{0,2}(.{1,32}?)\*{0,2}$/;

/** A short list where every item is "Label: <number-ish>" becomes a KPI row. */
function listToStats(items: ListItem[]): StatWidget[] | null {
  if (items.length < 2 || items.length > 8 || items.some((i) => i.done !== undefined)) {
    return null;
  }
  const stats: StatWidget[] = [];
  for (const item of items) {
    const match = item.text.match(STAT_LINE);
    if (!match || !/\d/.test(match[2])) return null;
    const { value, delta, direction } = splitDelta(match[2]);
    stats.push({ type: "stat", label: match[1].trim(), value, delta, direction });
  }
  return stats;
}

const ALERT_TONES: Record<string, CalloutTone> = {
  note: "info",
  tip: "success",
  important: "info",
  warning: "warning",
  caution: "danger",
};

/**
 * Builds a dashboard spec straight from Markdown structure — headings become
 * sections, numeric tables become charts, "Label: value" lists become KPI rows,
 * blockquotes become quotes/callouts, prose becomes text widgets. Total
 * function: always returns a renderable spec.
 */
export function specFromMarkdown(markdown: string, fallbackTitle = "Dashboard"): DashboardSpec {
  const lines = markdown.split(/\r?\n/);
  let title = fallbackTitle;
  let subtitle: string | undefined;
  let seenH1 = false;

  const sections: DashboardSection[] = [];
  let current: DashboardSection = { widgets: [] };
  let paragraph: string[] = [];

  const pushSection = () => {
    if (current.widgets.length > 0) sections.push(current);
    current = { widgets: [] };
  };

  const pushWidget = (widget: Widget) => {
    if (current.widgets.length < MAX_WIDGETS_PER_SECTION) current.widgets.push(widget);
  };

  const flushParagraph = () => {
    const text = paragraph.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    paragraph = [];
    if (!text) return;
    // The first short paragraph before any section becomes the dashboard subtitle.
    if (sections.length === 0 && !current.title && current.widgets.length === 0 && !subtitle && text.length <= 220 && !text.includes("\n")) {
      subtitle = text;
      return;
    }
    const last = current.widgets[current.widgets.length - 1];
    if (last?.type === "text" && !last.title && last.markdown.length + text.length < TEXT_WIDGET_MAX) {
      last.markdown = `${last.markdown}\n\n${text}`;
      return;
    }
    pushWidget({
      type: "text",
      markdown: text.slice(0, TEXT_WIDGET_MAX),
      size: text.length > 700 ? "full" : "lg",
    });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block → preserved inside a text widget.
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      flushParagraph();
      const closing = fence[1].slice(0, 3);
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith(closing)) j++;
      const block = lines.slice(i, Math.min(j + 1, lines.length)).join("\n");
      pushWidget({ type: "text", markdown: block.slice(0, TEXT_WIDGET_MAX), size: "lg" });
      i = j + 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      if (level === 1 && !seenH1 && sections.length === 0 && current.widgets.length === 0) {
        title = text || title;
        seenH1 = true;
      } else if (level <= 3) {
        flushParagraph();
        pushSection();
        current.title = text;
      } else {
        flushParagraph();
        paragraph.push(`**${text}**`);
      }
      i++;
      continue;
    }

    // GFM table.
    if (line.trim().startsWith("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushParagraph();
      const columns = splitTableRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) {
        rows.push(splitTableRow(lines[j]));
        j++;
      }
      for (const widget of tableToWidgets({ columns, rows })) pushWidget(widget);
      i = j;
      continue;
    }

    // Blockquote → callout (GFM alert) or quote.
    if (/^\s*>/.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      let j = i;
      while (j < lines.length && /^\s*>/.test(lines[j])) {
        quoted.push(lines[j].replace(/^\s*>\s?/, ""));
        j++;
      }
      const body = quoted.join("\n").trim();
      const alert = body.match(/^\[!(\w+)\]\s*\n?([\s\S]*)$/);
      if (alert && ALERT_TONES[alert[1].toLowerCase()]) {
        const text = alert[2].trim();
        if (text) {
          pushWidget({
            type: "callout",
            tone: ALERT_TONES[alert[1].toLowerCase()],
            title: alert[1][0] + alert[1].slice(1).toLowerCase(),
            text: text.slice(0, 800),
            size: "lg",
          });
        }
      } else if (body) {
        const attribution = body.match(/\n[—–-]\s*(.{2,60})$/);
        pushWidget({
          type: "quote",
          text: (attribution ? body.slice(0, attribution.index) : body).trim().slice(0, 600),
          attribution: attribution?.[1].trim(),
          size: "md",
        });
      }
      i = j;
      continue;
    }

    // List block (flattens nesting).
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      flushParagraph();
      const items: ListItem[] = [];
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      let j = i;
      while (j < lines.length) {
        const itemMatch = lines[j].match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
        if (itemMatch) {
          const parsed = asListItem(itemMatch[1]);
          if (parsed) items.push(parsed);
        } else if (/^\s{2,}\S/.test(lines[j]) && items.length > 0) {
          items[items.length - 1].text += ` ${lines[j].trim()}`;
        } else {
          break;
        }
        j++;
      }
      const stats = listToStats(items);
      if (stats) {
        for (const stat of stats) pushWidget({ ...stat, size: "sm" });
      } else if (items.length > 0) {
        pushWidget({ type: "list", items: items.slice(0, MAX_LIST_ITEMS), ordered, size: "md" });
      }
      i = j;
      continue;
    }

    // Horizontal rule: just a paragraph break.
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flushParagraph();
      i++;
      continue;
    }

    paragraph.push(line);
    i++;
  }

  flushParagraph();
  pushSection();

  if (sections.length === 0) {
    sections.push({
      widgets: [{ type: "text", markdown: markdown.trim().slice(0, TEXT_WIDGET_MAX) || "*Empty document.*", size: "full" }],
    });
  }

  return { title, subtitle, sections: sections.slice(0, MAX_SECTIONS) };
}
