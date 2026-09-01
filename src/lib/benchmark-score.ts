import type { ProviderKind } from "./models";

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

// --- statistics (pure, shared by the executor and the views) ---

/** Five-number summary plus mean/spread — the shape a box plot draws directly. */
export interface Distribution {
  min: number;
  /** Lower quartile. */
  q1: number;
  median: number;
  /** Upper quartile. */
  q3: number;
  p95: number;
  max: number;
  mean: number;
  stdDev: number;
  /** Relative spread (stdDev ÷ mean) — the consistency signal. */
  cv: number;
  count: number;
}

/** Linear-interpolated percentile over an unsorted sample; `p` is 0..1. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Full distribution of a sample; null for an empty sample. */
export function describe(values: number[]): Distribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  const variance =
    sorted.length > 1
      ? sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (sorted.length - 1)
      : 0;
  const stdDev = Math.sqrt(variance);
  return {
    min: sorted[0],
    q1: percentile(sorted, 0.25) ?? sorted[0],
    median: percentile(sorted, 0.5) ?? sorted[0],
    q3: percentile(sorted, 0.75) ?? sorted[0],
    p95: percentile(sorted, 0.95) ?? sorted[sorted.length - 1],
    max: sorted[sorted.length - 1],
    mean,
    stdDev,
    cv: mean > 0 ? stdDev / mean : 0,
    count: sorted.length,
  };
}

/**
 * Wilson score interval for a pass rate. The normal approximation misbehaves at
 * the edges — a model that passes every one of 12 tasks is not "100% ± 0" — and
 * a benchmark spends most of its time near those edges, so Wilson is the right
 * default.
 */
export interface Interval {
  /** Observed pass rate, 0..1. */
  rate: number;
  low: number;
  high: number;
  passes: number;
  trials: number;
}

/** 95% by default (z = 1.96). */
export function wilson(passes: number, trials: number, z = 1.96): Interval | null {
  if (trials <= 0) return null;
  const rate = passes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const centre = rate + z2 / (2 * trials);
  const spread = z * Math.sqrt((rate * (1 - rate) + z2 / (4 * trials)) / trials);
  return {
    rate,
    low: Math.max(0, (centre - spread) / denom),
    high: Math.min(1, (centre + spread) / denom),
    passes,
    trials,
  };
}

/**
 * Whether two pass rates are distinguishable at all. Overlapping intervals are
 * treated as a tie — conservative, but the failure it avoids (reading a ranking
 * into noise) is exactly the one a leaderboard invites.
 */
export function separable(a: Interval | null, b: Interval | null): boolean {
  if (!a || !b) return false;
  return a.low > b.high || b.low > a.high;
}

// --- request phases ---

/**
 * The four measured phases of one request, in pipeline order. They sum to the
 * cell's total latency, so a stacked bar of them is exactly the response time.
 */
export const PHASE_KEYS = ["encode", "queue", "prefill", "decode"] as const;

export type PhaseKey = (typeof PHASE_KEYS)[number];

export const PHASE_LABELS: Record<PhaseKey, string> = {
  encode: "Encode",
  queue: "Queue",
  prefill: "Prefill",
  decode: "Decode",
};

export const PHASE_HINTS: Record<PhaseKey, string> = {
  encode: "Building and serializing the request before it leaves the app.",
  queue: "On the wire until the server starts answering — transport and server queueing.",
  prefill: "Server evaluating the prompt (prompt eval) up to the first output token.",
  decode: "Generating output, from the first token to the end of the response.",
};

/** Milliseconds spent in each phase of a request. */
export type LatencyPhases = Record<PhaseKey, number>;

// --- shared view types for run summaries (computed server-side) ---

export interface ModelSummary {
  /**
   * Variant identity: the model id, suffixed with the temperature when the run
   * sweeps several. Unique within a run, and what every view keys off.
   */
  model: string;
  /** Which endpoint served this model — decides how its cost is billed. */
  provider: ProviderKind;
  /** Sampling temperature this variant ran at. */
  temperature: number;
  /** Unique display name (id without redundant path segments). */
  label: string;
  /** Mean score over completed scored (non-timing) tasks, 0..1. */
  score: number;
  /** Passed count over scored (non-timing) tasks. */
  passed: number;
  /** Confidence interval on the pass rate; null when nothing scored ran. */
  accuracy: Interval | null;
  /** Samples per task in this run (1 = single-shot). */
  repeats: number;
  /** Completed cells on scored (non-timing) tasks. */
  scoredCompleted: number;
  /** Completed cells across all tasks (drives run progress). */
  completed: number;
  errors: number;
  avgLatencyMs: number | null;
  avgTtftMs: number | null;
  avgTokensPerSecond: number | null;
  avgPrefillTokensPerSecond: number | null;
  /** Total request time across completed cells — the cost basis for this model. */
  totalLatencyMs: number;
  totalOutputTokens: number | null;
  totalPromptTokens: number | null;
  /** Mean ms in each request phase; null when no cell recorded the phase split. */
  phases: LatencyPhases | null;
  /** End-to-end response time across cells. */
  latency: Distribution | null;
  /** Time to first token across cells. */
  ttft: Distribution | null;
  /** Generation speed (tok/s) across cells. */
  decodeSpeed: Distribution | null;
  /** Steady-state gap between streamed chunks: median and 95th percentile, ms. */
  interToken: { p50: number; p95: number } | null;
  /** Time per output token (decode window ÷ output tokens), ms. */
  avgTpotMs: number | null;
  /**
   * The discarded warmup request's wall clock — mostly weight loading. Excluded
   * from every average above; null when the model was already warm or failed.
   */
  coldStartMs: number | null;
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
  /** How many samples of this cell ran, and how many of them passed. */
  samples: number;
  passCount: number;
  /** One entry per failed sample, saying how it failed. */
  failures: FailureKind[];
  latencyMs: number;
  ttftMs: number | null;
  tokensPerSecond: number | null;
  prefillTokensPerSecond: number | null;
  /** Phase split of this request; null for legacy rows and failed cells. */
  phases: LatencyPhases | null;
  interTokenP50Ms: number | null;
  interTokenP95Ms: number | null;
  promptTokens: number | null;
  outputTokens: number | null;
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

// --- concurrency probe ---

/** How a model held up with N identical requests in flight at once. */
export interface ConcurrencyPoint {
  /** Requests in flight. */
  level: number;
  /** Wall clock for the whole batch. */
  wallMs: number;
  /** Mean per-request response time at this level. */
  latencyMs: number;
  /** Batch output tokens ÷ batch wall clock — the server's aggregate throughput. */
  tokensPerSecond: number | null;
  errors: number;
}

export interface ConcurrencyReport {
  /** Whether this run asked for a probe at all. */
  requested: boolean;
  /** Keyed by model id, not variant — the probe measures the server, not sampling. */
  models: Record<string, ConcurrencyPoint[]>;
}

// --- baseline comparison ---

/** How one variant moved against the same variant in the pinned run. */
export interface BaselineDelta {
  /** The baseline's accuracy, in %. */
  baselineScore: number;
  /** Percentage points gained (or lost) since the baseline. */
  scoreDelta: number | null;
  /** Milliseconds added to the average response time; negative is faster. */
  latencyDeltaMs: number | null;
  /** Tokens/sec gained; negative is slower. */
  throughputDelta: number | null;
}

export interface BaselineComparison {
  runId: string;
  title: string;
  createdAt: string;
  /** Keyed by variant, so a sweep compares each temperature to its own past. */
  models: Record<string, BaselineDelta>;
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
  /** Model index with the highest prefill throughput; null without data. */
  fastestPrefill: number | null;
  /** Model index with the steadiest response time (lowest CV); null without data. */
  mostConsistent: number | null;
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

  const withPrefill = summary.models
    .map((m, i) => ({ i, v: m.avgPrefillTokensPerSecond }))
    .filter((e): e is { i: number; v: number } => e.v !== null && e.v > 0);
  const fastestPrefill =
    withPrefill.length > 0 ? withPrefill.reduce((a, b) => (b.v > a.v ? b : a)).i : null;

  // Consistency needs more than one sample per model, else CV is a meaningless 0.
  const withSpread = summary.models
    .map((m, i) => ({ i, v: m.latency !== null && m.latency.count > 1 ? m.latency.cv : null }))
    .filter((e): e is { i: number; v: number } => e.v !== null);
  const mostConsistent =
    withSpread.length > 1 ? withSpread.reduce((a, b) => (b.v < a.v ? b : a)).i : null;

  return {
    ranked,
    categories,
    fastestLatency,
    latencyAdvantage,
    fastestGeneration,
    fastestPrefill,
    mostConsistent,
  };
}

// --- performance profile (the radar's data) ---

export interface ProfileAxis {
  key: string;
  label: string;
  /** Unit of `raw`, for the axis tick and the table view. */
  unit: string;
  /** Raw metric per model, aligned with the run's model order; null = no data. */
  raw: (number | null)[];
  /** `raw` as a share of the run's best on this axis, 0..100. */
  values: (number | null)[];
  /** The run's best raw value on this axis. */
  best: number;
  /** True when a smaller raw value is the better one (latency-like axes). */
  lowerIsBetter: boolean;
}

interface AxisSpec {
  key: string;
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  pick: (m: ModelSummary) => number | null;
}

const PROFILE_AXES: AxisSpec[] = [
  {
    key: "accuracy",
    label: "Accuracy",
    unit: "%",
    lowerIsBetter: false,
    pick: (m) => (m.scoredCompleted > 0 ? m.score * 100 : null),
  },
  {
    key: "decode",
    label: "Decode",
    unit: "tok/s",
    lowerIsBetter: false,
    pick: (m) => m.avgTokensPerSecond,
  },
  {
    key: "prefill",
    label: "Prefill",
    unit: "tok/s",
    lowerIsBetter: false,
    pick: (m) => m.avgPrefillTokensPerSecond,
  },
  { key: "ttft", label: "TTFT", unit: "ms", lowerIsBetter: true, pick: (m) => m.avgTtftMs },
  {
    key: "turnaround",
    label: "Turnaround",
    unit: "ms",
    lowerIsBetter: true,
    pick: (m) => m.avgLatencyMs,
  },
  {
    key: "consistency",
    label: "Steadiness",
    unit: "%",
    lowerIsBetter: true,
    // Spread as a percentage of the mean; floored so a single-sample 0 never wins.
    pick: (m) =>
      m.latency !== null && m.latency.count > 1 ? Math.max(m.latency.cv * 100, 0.1) : null,
  },
];

/**
 * Per-model performance profile: every axis scaled to the best model in this run
 * (100 = the run's leader on that axis), so wildly different units — %, tok/s,
 * ms — share one radar. Axes where nobody produced a number are dropped.
 */
export function buildProfile(summary: RunSummaryView): ProfileAxis[] {
  const axes: ProfileAxis[] = [];
  for (const spec of PROFILE_AXES) {
    const raw = summary.models.map(spec.pick);
    const present = raw.filter((v): v is number => v !== null && v > 0);
    if (present.length === 0) continue;
    const best = spec.lowerIsBetter ? Math.min(...present) : Math.max(...present);
    if (best <= 0) continue;
    axes.push({
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      lowerIsBetter: spec.lowerIsBetter,
      raw,
      best,
      values: raw.map((v) =>
        v === null || v <= 0
          ? null
          : Math.min(100, (spec.lowerIsBetter ? best / v : v / best) * 100),
      ),
    });
  }
  return axes;
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

// --- failure taxonomy ---

/**
 * Why a sample failed. "12/30 passed" hides the difference between a model that
 * is wrong and one that is right but answered in a shape the scorer would not
 * take — the second is a prompt or scorer problem, and it is the cheaper fix.
 */
export const FAILURE_KINDS = [
  "wrong",
  "format",
  "refusal",
  "truncated",
  "empty",
  "timeout",
  "error",
] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];

export const FAILURE_LABELS: Record<FailureKind, string> = {
  wrong: "Wrong answer",
  format: "Format miss",
  refusal: "Refused",
  truncated: "Cut off",
  empty: "Empty reply",
  timeout: "Timed out",
  error: "Request failed",
};

export const FAILURE_HINTS: Record<FailureKind, string> = {
  wrong: "Answered, and the answer is not the expected one.",
  format:
    "The expected answer is in the reply but not in a shape the scorer accepts \u2014 usually a prompt fix, not a model one.",
  refusal: "Declined the task instead of attempting it.",
  truncated: "Ran into the output ceiling and stopped mid-answer.",
  empty: "Returned nothing to score.",
  timeout: "Did not finish inside the per-task time limit.",
  error: "The request itself failed \u2014 connection, unloaded model, or server error.",
};

const REFUSAL_PATTERNS = [
  /\bi (?:cannot|can'?t|will not|won'?t|am unable to)\b/i,
  /\bi'?m (?:sorry|afraid|not able)\b/i,
  /\bas an ai\b/i,
  /\bi (?:do not|don'?t) (?:have|feel comfortable)\b/i,
];

/**
 * Whether the output ceiling almost certainly clipped the reply. The token
 * count is the reliable signal; the length test only catches servers that do
 * not report usage, and is deliberately strict so a terse answer never counts.
 */
function looksTruncated(
  output: string,
  outputTokens: number | null,
  cap: number | null,
): boolean {
  if (cap !== null && outputTokens !== null && outputTokens >= cap - 8) return true;
  const text = output.trimEnd();
  return text.length > 600 && /[A-Za-z0-9,;:-]$/.test(text);
}

/**
 * The expected answer is present but the scorer could not take it. Only claimed
 * where the evidence is unambiguous \u2014 a false "format" reading would excuse a
 * model that is simply wrong.
 */
function looksMisformatted(
  task: { scoring: ScoringKind; expected?: string },
  output: string,
): boolean {
  const expected = task.expected?.trim() ?? "";
  if (expected === "") return false;

  switch (task.scoring) {
    case "numeric": {
      const target = Number(expected.replace(/[$,%]/g, ""));
      if (!Number.isFinite(target)) return false;
      const tolerance = Math.max(1e-6, Math.abs(target) * 1e-4);
      const tokens = output.match(/-?\$?[\d,]+(?:\.\d+)?%?/g) ?? [];
      // The number is somewhere in the reply, just not where the scorer looks.
      return tokens.some((token) => {
        const value = Number(token.replace(/[$,%]/g, ""));
        return Number.isFinite(value) && Math.abs(value - target) <= tolerance;
      });
    }
    case "mcq": {
      const want = expected.toUpperCase();
      return new RegExp(`\\b${want}\\b`).test(output) && extractLetter(output) !== want;
    }
    case "exact":
      return looseNormalize(output).includes(looseNormalize(expected));
    case "regex": {
      // Only anchored patterns can tell format from content: if dropping the
      // anchors makes it match, the answer is there and only the wrapping is
      // wrong. An unanchored pattern that failed simply did not match.
      const anchored = expected.startsWith("^") && expected.endsWith("$");
      if (!anchored) return false;
      try {
        return new RegExp(expected.slice(1, -1), "i").test(output);
      } catch {
        return false;
      }
    }
    case "json": {
      // A reply that never parses as JSON but does carry the expected keys is a
      // formatting failure, not a knowledge one.
      if (extractJsonBlock(output) !== undefined) return false;
      let want: unknown;
      try {
        want = JSON.parse(expected);
      } catch {
        return false;
      }
      if (!want || typeof want !== "object" || Array.isArray(want)) return false;
      const keys = Object.keys(want as Record<string, unknown>);
      return keys.length > 0 && keys.every((key) => output.includes(key));
    }
    default:
      return false;
  }
}

/** One executed sample, as much of it as the taxonomy needs. */
export interface FailureSample {
  passed: boolean;
  output: string;
  error: string | null;
  outputTokens: number | null;
}

/**
 * Buckets one failed sample; null for a sample that passed. `outputCap` is the
 * run's max output tokens, which is what makes "cut off" detectable at all.
 */
export function classifyFailure(
  task: { scoring: ScoringKind; expected?: string },
  sample: FailureSample,
  outputCap: number | null = null,
): FailureKind | null {
  if (sample.passed) return null;
  if (sample.error) {
    return /timed out|timeout|abort/i.test(sample.error) ? "timeout" : "error";
  }
  if (sample.output.trim() === "") return "empty";
  if (REFUSAL_PATTERNS.some((pattern) => pattern.test(sample.output))) return "refusal";
  if (looksTruncated(sample.output, sample.outputTokens, outputCap)) return "truncated";
  if (looksMisformatted(task, sample.output)) return "format";
  return "wrong";
}

/** The kind that accounts for most of a cell's failures; null when none failed. */
export function dominantFailure(kinds: FailureKind[]): FailureKind | null {
  if (kinds.length === 0) return null;
  const tally = new Map<FailureKind, number>();
  for (const kind of kinds) tally.set(kind, (tally.get(kind) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** How one model's failed samples break down, plus how unstable it was. */
export interface FailureProfile {
  model: string;
  label: string;
  counts: Record<FailureKind, number>;
  /** Failed samples (the counts sum to this). */
  failed: number;
  /** Scored samples this model completed. */
  samples: number;
  /** Tasks it neither always passed nor always failed \u2014 only meaningful with repeats. */
  flaky: number;
}

export function failureProfiles(summary: RunSummaryView): FailureProfile[] {
  return summary.models.map((model, mi) => {
    const counts = Object.fromEntries(FAILURE_KINDS.map((k) => [k, 0])) as Record<
      FailureKind,
      number
    >;
    let failed = 0;
    let samples = 0;
    let flaky = 0;
    for (const row of summary.tasks) {
      if (isTimingOnly(row.scoring)) continue;
      const cell = row.cells[mi];
      if (!cell) continue;
      samples += cell.samples;
      failed += cell.samples - cell.passCount;
      if (cell.passCount > 0 && cell.passCount < cell.samples) flaky += 1;
      for (const kind of cell.failures) counts[kind] += 1;
    }
    return { model: model.model, label: model.label, counts, failed, samples, flaky };
  });
}

// --- head-to-head ---

/** One task as the two compared models each answered it. */
export interface HeadToHeadSide {
  passCount: number;
  samples: number;
  /** Dominant failure kind; null when the side passed every sample. */
  failure: FailureKind | null;
  output: string;
}

export interface HeadToHeadTask {
  index: number;
  name: string;
  category: string;
  a: HeadToHeadSide;
  b: HeadToHeadSide;
}

export interface HeadToHead {
  /** Tasks the first model passed and the second did not. */
  onlyA: HeadToHeadTask[];
  /** And the other direction \u2014 the half a single leaderboard number hides. */
  onlyB: HeadToHeadTask[];
  bothFailed: HeadToHeadTask[];
  bothPassed: number;
  /** Scored tasks where both models produced a result. */
  compared: number;
}

const side = (cell: TaskCellView): HeadToHeadSide => ({
  passCount: cell.passCount,
  samples: cell.samples,
  failure: dominantFailure(cell.failures),
  output: cell.output,
});

/**
 * Splits two models' scored tasks four ways. Two models on 70% can disagree on
 * every task they get wrong, and that disagreement is the actionable part \u2014 it
 * says which one to keep for which work.
 */
export function headToHead(summary: RunSummaryView, ai: number, bi: number): HeadToHead {
  const onlyA: HeadToHeadTask[] = [];
  const onlyB: HeadToHeadTask[] = [];
  const bothFailed: HeadToHeadTask[] = [];
  let bothPassed = 0;
  let compared = 0;

  for (const row of summary.tasks) {
    if (isTimingOnly(row.scoring)) continue;
    const ca = row.cells[ai];
    const cb = row.cells[bi];
    if (!ca || !cb) continue;
    compared += 1;
    if (ca.passed && cb.passed) {
      bothPassed += 1;
      continue;
    }
    const entry: HeadToHeadTask = {
      index: row.index,
      name: row.name,
      category: row.category,
      a: side(ca),
      b: side(cb),
    };
    if (ca.passed) onlyA.push(entry);
    else if (cb.passed) onlyB.push(entry);
    else bothFailed.push(entry);
  }

  return { onlyA, onlyB, bothFailed, bothPassed, compared };
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
  avgPrefillTokensPerSecond: number | null;
  /** Mean ms per request phase; null when the run predates the phase split. */
  phases: LatencyPhases | null;
  /** Time per output token, ms. */
  avgTpotMs: number | null;
  /** Tail response time across the run's tasks, ms. */
  p95LatencyMs: number | null;
  /** Relative spread of response time (stdDev ÷ mean) — lower is steadier. */
  latencyCv: number | null;
  totalLatencyMs: number;
  totalOutputTokens: number | null;
  totalPromptTokens: number | null;
  /** $/hour used for this run's estimate (snapshot, else current setting); null = none. */
  costPerHour: number | null;
  /** Self-reported estimate: totalLatencyMs × costPerHour. */
  estimatedCost: number | null;
}
