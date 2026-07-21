/**
 * Benchmark task model + deterministic scoring. Pure functions shared by the
 * server executor and the client views — no zod, no server-only imports. The
 * one non-deterministic scorer ("judge", LLM-graded) lives in `benchmarks.ts`.
 */

export const SCORING_KINDS = [
  "exact",
  "contains",
  "numeric",
  "regex",
  "mcq",
  "json",
  "judge",
  "timing",
] as const;

export type ScoringKind = (typeof SCORING_KINDS)[number];

export const SCORING_LABELS: Record<ScoringKind, string> = {
  exact: "Exact text",
  contains: "Contains text",
  numeric: "Numeric answer",
  regex: "Regex match",
  mcq: "Multiple choice (A–D)",
  json: "JSON match",
  judge: "AI judge (0–10)",
  timing: "Timing only (no check)",
};

/** Tasks with this scoring are excluded from accuracy averages — only their timings count. */
export const isTimingOnly = (scoring: ScoringKind): boolean => scoring === "timing";

export interface BenchTask {
  name: string;
  category: string;
  prompt: string;
  /** Extra user turns sent after the model answers `prompt`; the final reply is scored. */
  followups?: string[];
  scoring: ScoringKind;
  /**
   * Reference for the scorer: the exact/contained text, the number, the regex
   * source, the MCQ letter, the JSON to match, or the judge's reference answer.
   * Unused for "timing" tasks.
   */
  expected?: string;
}

export interface TaskScore {
  /** 0..1 */
  score: number;
  passed: boolean;
  /** Scoring-configuration problem (bad regex, unparseable expected JSON). */
  error?: string;
}

// --- shared view types for run summaries (computed server-side) ---

export interface ModelSummary {
  model: string;
  /** Unique display name (id without redundant path segments). */
  label: string;
  /** Mean score over completed scored (non-timing) tasks, 0..1. */
  score: number;
  /** Passed count over scored (non-timing) tasks. */
  passed: number;
  /** Completed cells on scored (non-timing) tasks. */
  scoredCompleted: number;
  /** Completed cells across all tasks (drives run progress). */
  completed: number;
  errors: number;
  avgLatencyMs: number | null;
  avgTtftMs: number | null;
  avgTokensPerSecond: number | null;
  avgPromptTokensPerSecond: number | null;
  /** Total request time across completed cells — the cost basis for this model. */
  totalLatencyMs: number;
  totalOutputTokens: number | null;
}

export interface CategorySummary {
  category: string;
  /** Mean score % per model (aligned with the run's model order); null = no data. */
  scores: (number | null)[];
}

export interface TaskCellView {
  output: string;
  score: number;
  passed: boolean;
  latencyMs: number;
  ttftMs: number | null;
  tokensPerSecond: number | null;
  promptTokensPerSecond: number | null;
  error: string | null;
}

export interface TaskRowView {
  index: number;
  name: string;
  category: string;
  scoring: ScoringKind;
  expected?: string;
  prompt: string;
  /** Aligned with the run's model order; null = not executed yet. */
  cells: (TaskCellView | null)[];
}

export interface RunSummaryView {
  models: ModelSummary[];
  categories: CategorySummary[];
  tasks: TaskRowView[];
  completed: number;
  total: number;
}

// --- verdicts (which model for which task) ---

export interface CategoryVerdict {
  category: string;
  /** Model indices tied at the top score (within half a point). */
  winners: number[];
  /** Top score, in %. */
  topScore: number;
  /** Points over the best non-winner; null when everyone tied / no runner-up data. */
  margin: number | null;
}

export interface RunVerdicts {
  /** Model indices sorted by overall score, best first. */
  ranked: number[];
  /** Only categories where at least two models have data. */
  categories: CategoryVerdict[];
  /** Model index with the lowest average latency; null without timing data. */
  fastestLatency: number | null;
  /** How many times faster the fastest model responds vs the overall leader; null when the leader is fastest. */
  latencyAdvantage: number | null;
  /** Model index with the highest tokens/sec; null without data. */
  fastestGeneration: number | null;
}

const TIE_EPSILON = 0.5;

/** Derives per-use-case winners and speed calls from a run summary. Pure data — wording is the view's job. */
export function buildVerdicts(summary: RunSummaryView): RunVerdicts {
  const ranked = summary.models
    .map((_, i) => i)
    .sort((a, b) => summary.models[b].score - summary.models[a].score);

  const categories: CategoryVerdict[] = [];
  for (const cat of summary.categories) {
    const scored = cat.scores
      .map((score, i) => ({ i, score }))
      .filter((e): e is { i: number; score: number } => e.score !== null);
    if (scored.length < 2) continue;
    const top = Math.max(...scored.map((e) => e.score));
    const winners = scored.filter((e) => top - e.score < TIE_EPSILON).map((e) => e.i);
    const losers = scored.filter((e) => !winners.includes(e.i));
    categories.push({
      category: cat.category,
      winners,
      topScore: top,
      margin: losers.length > 0 ? top - Math.max(...losers.map((e) => e.score)) : null,
    });
  }

  const withLatency = summary.models
    .map((m, i) => ({ i, v: m.avgLatencyMs }))
    .filter((e): e is { i: number; v: number } => e.v !== null && e.v > 0);
  const fastestLatency =
    withLatency.length > 0 ? withLatency.reduce((a, b) => (b.v < a.v ? b : a)).i : null;

  let latencyAdvantage: number | null = null;
  const leader = ranked[0];
  if (fastestLatency !== null && leader !== undefined && fastestLatency !== leader) {
    const leaderLatency = summary.models[leader].avgLatencyMs;
    const fastest = summary.models[fastestLatency].avgLatencyMs;
    if (leaderLatency !== null && fastest !== null && fastest > 0) {
      latencyAdvantage = leaderLatency / fastest;
    }
  }

  const withTps = summary.models
    .map((m, i) => ({ i, v: m.avgTokensPerSecond }))
    .filter((e): e is { i: number; v: number } => e.v !== null && e.v > 0);
  const fastestGeneration =
    withTps.length > 0 ? withTps.reduce((a, b) => (b.v > a.v ? b : a)).i : null;

  return { ranked, categories, fastestLatency, latencyAdvantage, fastestGeneration };
}

// --- extraction helpers ---

const looseNormalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Strips code fences, surrounding quotes, and a single trailing period. */
export function stripWrapping(text: string): string {
  let out = text.trim();
  out = out.replace(/^```[a-z]*\s*\n?/i, "").replace(/\n?\s*```$/i, "").trim();
  const quoted = out.match(/^["'`]([\s\S]*)["'`]$/);
  if (quoted) out = quoted[1].trim();
  return out.replace(/\.$/, "").trim();
}

function parseNumericToken(token: string): number | null {
  const cleaned = token.replace(/[$,%]/g, "");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Pulls the model's final numeric answer: an "Answer: n" line wins, else the last number. */
export function extractNumber(text: string): number | null {
  const answer = text.match(/answer\s*(?:is|:|=)?\s*\**\$?\s*(-?[\d,]+(?:\.\d+)?)/i);
  if (answer) {
    return parseNumericToken(answer[1]);
  }
  const all = text.match(/-?\$?[\d,]+(?:\.\d+)?%?/g);
  if (!all || all.length === 0) return null;
  return parseNumericToken(all[all.length - 1]);
}

/** Pulls an A–D multiple-choice answer out of the response. */
export function extractLetter(text: string): string | null {
  const patterns = [
    /answer\s*(?:is|:)?\s*\**\(?([A-D])\)?\b/i, // "Answer: C"
    /^\W*\(?([A-D])\)?\W*$/im, // a line that is just the letter
    /\b([A-D])\)/, // "C) Saturn"
    /\*\*\(?([A-D])\)?\*\*/, // bolded letter
    /\b([A-D])\b/, // last resort
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

/** Parses the earliest JSON object/array in the text. */
export function extractJsonBlock(text: string): unknown {
  const starts = [text.indexOf("{"), text.indexOf("[")].filter((i) => i !== -1);
  if (starts.length === 0) return undefined;
  const start = Math.min(...starts);
  const close = text[start] === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  if (end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** Expected is a subset of actual: objects by key, arrays exactly, scalars loosely. */
function subsetMatch(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((item, i) => subsetMatch(item, actual[i]))
    );
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key, value]) =>
      subsetMatch(value, (actual as Record<string, unknown>)[key]),
    );
  }
  if (typeof expected === "number" && typeof actual === "number") {
    return Math.abs(expected - actual) < 1e-9;
  }
  if (typeof expected === "string" && typeof actual === "string") {
    return looseNormalize(expected) === looseNormalize(actual);
  }
  return expected === actual;
}

const fail = (error?: string): TaskScore => ({ score: 0, passed: false, error });
const graded = (passed: boolean): TaskScore => ({ score: passed ? 1 : 0, passed });

/** Scores every kind except "judge" (which needs a model — see benchmarks.ts). */
export function scoreDeterministic(task: BenchTask, output: string): TaskScore {
  const expected = task.expected?.trim() ?? "";

  switch (task.scoring) {
    case "exact": {
      const got = stripWrapping(output).replace(/\s+/g, " ");
      return graded(got === expected.replace(/\s+/g, " "));
    }
    case "contains":
      return graded(expected !== "" && looseNormalize(output).includes(looseNormalize(expected)));
    case "numeric": {
      const target = Number(expected.replace(/[$,%]/g, ""));
      if (!Number.isFinite(target)) return fail("Expected value is not a number.");
      const got = extractNumber(output);
      if (got === null) return graded(false);
      return graded(Math.abs(got - target) <= Math.max(1e-6, Math.abs(target) * 1e-4));
    }
    case "mcq":
      return graded(extractLetter(output) === expected.toUpperCase());
    case "regex": {
      let pattern: RegExp;
      try {
        pattern = new RegExp(expected, "i");
      } catch {
        return fail("Invalid regex in task definition.");
      }
      return graded(pattern.test(output.trim()) || pattern.test(stripWrapping(output)));
    }
    case "json": {
      const got = extractJsonBlock(output);
      if (got === undefined) return graded(false);
      if (!expected) return graded(true);
      let want: unknown;
      try {
        want = JSON.parse(expected);
      } catch {
        return fail("Expected value is not valid JSON.");
      }
      return graded(subsetMatch(want, got));
    }
    case "judge":
      return fail("Judge scoring requires a model.");
    case "timing":
      // Nothing to check — the run only records latency and throughput.
      return { score: 1, passed: true };
  }
}

/**
 * Short, unique display names for a set of model ids: the segment after the
 * last "/" unless that collides, in which case the full id is kept.
 */
export function modelLabels(models: string[]): string[] {
  const shorts = models.map((m) => m.split("/").pop() || m);
  return shorts.map((short, i) =>
    shorts.filter((s) => s === short).length > 1 ? models[i] : short,
  );
}

// --- cross-run history (computed server-side, rendered by the History tab) ---

/** One model's aggregate for one run — a point in the over-time comparison. */
export interface HistoryEntry {
  runId: string;
  runTitle: string;
  suiteId: string | null;
  suiteName: string;
  status: string;
  createdAt: string;
  model: string;
  /** Mean score 0..1 over scored tasks; null when the run had only timing tasks. */
  score: number | null;
  avgLatencyMs: number | null;
  avgTtftMs: number | null;
  avgTokensPerSecond: number | null;
  avgPromptTokensPerSecond: number | null;
  totalLatencyMs: number;
  totalOutputTokens: number | null;
  /** $/hour used for this run's estimate (snapshot, else current setting); null = none. */
  costPerHour: number | null;
  /** Self-reported estimate: totalLatencyMs × costPerHour. */
  estimatedCost: number | null;
}
