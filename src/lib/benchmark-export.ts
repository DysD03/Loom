import {
  classifyFailure,
  type BenchTask,
  type FailureKind,
  type ScoringKind,
} from "./benchmark-score";

/**
 * Raw per-sample export of a run. The charts in the app answer the questions we
 * anticipated; this answers the ones we did not — every sample, every timing,
 * every output, in a shape a spreadsheet or a notebook can take.
 */

export const EXPORT_FORMATS = ["csv", "json"] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function parseFormat(value: string | null | undefined): ExportFormat {
  return value === "json" ? "json" : "csv";
}

/** One executed sample, joined to the task it answered. */
export interface ExportRow {
  model: string;
  taskIndex: number;
  repeatIndex: number;
  output: string;
  score: number;
  passed: boolean;
  latencyMs: number;
  ttftMs: number | null;
  encodeMs: number | null;
  queueMs: number | null;
  prefillMs: number | null;
  decodeMs: number | null;
  interTokenP50Ms: number | null;
  interTokenP95Ms: number | null;
  streamChunks: number | null;
  outputTokens: number | null;
  promptTokens: number | null;
  tokensPerSecond: number | null;
  prefillTokensPerSecond: number | null;
  error: string | null;
  createdAt: string;
}

export interface ExportRun {
  id: string;
  title: string;
  suiteName: string;
  status: string;
  temperature: number;
  repeats: number;
  models: string[];
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ExportInput {
  run: ExportRun;
  tasks: BenchTask[];
  rows: ExportRow[];
  /** Output ceiling the run used — what makes a "cut off" reading possible. */
  outputCap: number | null;
}

interface FlatRow {
  run_id: string;
  run_title: string;
  suite: string;
  temperature: number;
  repeats: number;
  model: string;
  task_index: number;
  task_name: string;
  category: string;
  scoring: ScoringKind | "";
  expected: string;
  repeat_index: number;
  passed: 0 | 1;
  score: number;
  failure_kind: FailureKind | "";
  latency_ms: number;
  ttft_ms: number | null;
  encode_ms: number | null;
  queue_ms: number | null;
  prefill_ms: number | null;
  decode_ms: number | null;
  inter_token_p50_ms: number | null;
  inter_token_p95_ms: number | null;
  stream_chunks: number | null;
  prompt_tokens: number | null;
  output_tokens: number | null;
  tokens_per_second: number | null;
  prefill_tokens_per_second: number | null;
  error: string;
  output: string;
  created_at: string;
}

const COLUMNS: (keyof FlatRow)[] = [
  "run_id",
  "run_title",
  "suite",
  "temperature",
  "repeats",
  "model",
  "task_index",
  "task_name",
  "category",
  "scoring",
  "expected",
  "repeat_index",
  "passed",
  "score",
  "failure_kind",
  "latency_ms",
  "ttft_ms",
  "encode_ms",
  "queue_ms",
  "prefill_ms",
  "decode_ms",
  "inter_token_p50_ms",
  "inter_token_p95_ms",
  "stream_chunks",
  "prompt_tokens",
  "output_tokens",
  "tokens_per_second",
  "prefill_tokens_per_second",
  "error",
  "output",
  "created_at",
];

/** Joins each sample to its task and its failure kind, ready to serialize. */
export function flatten(input: ExportInput): FlatRow[] {
  const { run, tasks, rows, outputCap } = input;
  const ordered = [...rows].sort(
    (a, b) =>
      run.models.indexOf(a.model) - run.models.indexOf(b.model) ||
      a.taskIndex - b.taskIndex ||
      a.repeatIndex - b.repeatIndex,
  );
  return ordered.map((row) => {
    const task = tasks[row.taskIndex];
    return {
      run_id: run.id,
      run_title: run.title,
      suite: run.suiteName,
      temperature: run.temperature,
      repeats: run.repeats,
      model: row.model,
      task_index: row.taskIndex,
      task_name: task?.name ?? "",
      category: task?.category ?? "",
      scoring: task?.scoring ?? "",
      expected: task?.expected ?? "",
      repeat_index: row.repeatIndex,
      passed: row.passed ? 1 : 0,
      score: row.score,
      failure_kind: task ? (classifyFailure(task, row, outputCap) ?? "") : "",
      latency_ms: row.latencyMs,
      ttft_ms: row.ttftMs,
      encode_ms: row.encodeMs,
      queue_ms: row.queueMs,
      prefill_ms: row.prefillMs,
      decode_ms: row.decodeMs,
      inter_token_p50_ms: row.interTokenP50Ms,
      inter_token_p95_ms: row.interTokenP95Ms,
      stream_chunks: row.streamChunks,
      prompt_tokens: row.promptTokens,
      output_tokens: row.outputTokens,
      tokens_per_second: row.tokensPerSecond,
      prefill_tokens_per_second: row.prefillTokensPerSecond,
      error: row.error ?? "",
      output: row.output,
      created_at: row.createdAt,
    };
  });
}

/**
 * RFC 4180 field: quote when the value could otherwise break a row, and double
 * any embedded quote. Model outputs contain commas, quotes and newlines as a
 * matter of course, so this is the whole ballgame.
 */
function csvField(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(input: ExportInput): string {
  const rows = flatten(input);
  const lines = [COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(COLUMNS.map((column) => csvField(row[column])).join(","));
  }
  // Trailing newline: some tools drop the last row without one.
  return `${lines.join("\r\n")}\r\n`;
}

export function toJson(input: ExportInput): string {
  return `${JSON.stringify(
    {
      run: input.run,
      tasks: input.tasks,
      outputCap: input.outputCap,
      exportedAt: new Date().toISOString(),
      results: flatten(input),
    },
    null,
    2,
  )}\n`;
}

/** Filesystem-safe stem: "Quick check vs 3" → "quick-check-vs-3". */
export function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 60) || "run";
}

export function exportFilename(run: ExportRun, format: ExportFormat): string {
  const day = (run.createdAt.split(/[ T]/)[0] || "").replace(/[^0-9-]/g, "");
  return `loom-benchmark-${slug(run.title)}${day ? `-${day}` : ""}.${format}`;
}
