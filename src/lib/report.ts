/**
 * Benchmark report composition: which sections a printable report can carry and
 * how that choice survives a round-trip through the URL. Pure and client-safe —
 * the export form and the report route both read from here so a preview and its
 * printed PDF can never disagree.
 */

export const REPORT_SECTIONS = [
  {
    key: "leaderboard",
    label: "Leaderboard & accuracy",
    hint: "Ranked scores, pass counts, and accuracy by category.",
  },
  {
    key: "phases",
    label: "Latency breakdown",
    hint: "Mean encode / queue / prefill / decode per model.",
  },
  {
    key: "distribution",
    label: "Latency distributions",
    hint: "Response time and TTFT spread — median, quartiles, p95.",
  },
  {
    key: "throughput",
    label: "Throughput",
    hint: "Decode and prefill speed, time per output token.",
  },
  {
    key: "metrics",
    label: "All-metrics table",
    hint: "Every measured number, one row per model.",
  },
  {
    key: "tasks",
    label: "Per-task results",
    hint: "The task matrix with each model's outcome and timing.",
  },
  {
    key: "cost",
    label: "Cost estimate",
    hint: "Self-reported compute cost, when a $/hour rate is set.",
  },
] as const;

export type ReportSection = (typeof REPORT_SECTIONS)[number]["key"];

const ALL_KEYS = REPORT_SECTIONS.map((s) => s.key);

export const DEFAULT_SECTIONS: ReportSection[] = [...ALL_KEYS];

function isSection(value: string): value is ReportSection {
  return (ALL_KEYS as readonly string[]).includes(value);
}

/**
 * Reads the `sections` query parameter. An absent parameter means "everything";
 * an explicit but unusable one still yields the default rather than an empty
 * report, so a hand-edited URL can never produce a blank page.
 */
export function parseSections(param: string | undefined): ReportSection[] {
  if (param === undefined) return [...DEFAULT_SECTIONS];
  const picked = param
    .split(",")
    .map((s) => s.trim())
    .filter(isSection);
  const unique = [...new Set(picked)];
  if (unique.length === 0) return [...DEFAULT_SECTIONS];
  // Keep the canonical order regardless of how the parameter was written.
  return ALL_KEYS.filter((key) => unique.includes(key));
}

export function serializeSections(sections: ReportSection[]): string {
  return ALL_KEYS.filter((key) => sections.includes(key)).join(",");
}

/** The report URL for a run, with its section choice attached. */
export function reportHref(runId: string, sections: ReportSection[]): string {
  const base = `/benchmarks/report/${encodeURIComponent(runId)}`;
  if (sections.length === ALL_KEYS.length) return base;
  return `${base}?sections=${serializeSections(sections)}`;
}
