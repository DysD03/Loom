import "server-only";

import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { generateText, streamText, type LanguageModel, type ModelMessage } from "ai";

import { db } from "@/db/client";
import {
  benchmarkResults,
  benchmarkRuns,
  benchmarkSuites,
  type BenchmarkResult,
  type BenchmarkRun,
  type BenchmarkSuite,
} from "@/db/schema";
import { availableProviders, getChatModel, getUtilityModel } from "./provider";
import { parseModel } from "./models";
import { getSettings } from "./settings";
import { costOfMs } from "./benchmark-cost";
import {
  classifyFailure,
  describe,
  isTimingOnly,
  modelLabels,
  percentile,
  scoreDeterministic,
  wilson,
  type BenchTask,
  type CategorySummary,
  type FailureKind,
  type HistoryEntry,
  type LatencyPhases,
  type ModelSummary,
  type RunSummaryView,
  type TaskCellView,
  type TaskScore,
} from "./benchmark-score";
import { BUILTIN_SUITES } from "./benchmark-suites";

export const MAX_MODELS_PER_RUN = 5;
export const MAX_TEMPERATURE = 2;
export const MAX_REPEATS = 10;

/** Samples per task, bounded so a stray value cannot turn one run into thousands. */
export function clampRepeats(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.round(value), 1), MAX_REPEATS);
}

/** Keeps a user-supplied temperature inside what OpenAI-compatible servers accept. */
export function clampTemperature(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), MAX_TEMPERATURE);
}
/**
 * Generous enough that a slow local model working through a hard task is
 * measured rather than cut off. A timeout is recorded as a failed cell, so an
 * over-tight limit would silently score "too slow" as "wrong".
 */
/** Output ceiling per task. Exported so "cut off" is detectable after the fact. */
export const MAX_OUTPUT_TOKENS = 4_096;

const TASK_TIMEOUT_MS = 180_000;
const JUDGE_TIMEOUT_MS = 60_000;
const OUTPUT_STORE_MAX = 6_000;

const BENCH_SYSTEM =
  "You are being evaluated by an automated benchmark. Follow the task instructions exactly and answer concisely.";

// --- suites ---

/** Seeds/refreshes the built-in suites (stable ids, so edits here overwrite). */
export function ensureBuiltinSuites(): void {
  for (const suite of BUILTIN_SUITES) {
    const tasks = JSON.stringify(suite.tasks);
    const existing = db
      .select({ id: benchmarkSuites.id, tasks: benchmarkSuites.tasks })
      .from(benchmarkSuites)
      .where(eq(benchmarkSuites.id, suite.id))
      .get();
    if (!existing) {
      db.insert(benchmarkSuites)
        .values({
          id: suite.id,
          name: suite.name,
          description: suite.description,
          builtin: true,
          tasks,
        })
        .run();
    } else if (existing.tasks !== tasks) {
      db.update(benchmarkSuites)
        .set({
          name: suite.name,
          description: suite.description,
          tasks,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(benchmarkSuites.id, suite.id))
        .run();
    }
  }
}

export function listSuites(): BenchmarkSuite[] {
  return db
    .select()
    .from(benchmarkSuites)
    .orderBy(desc(benchmarkSuites.builtin), desc(benchmarkSuites.updatedAt))
    .all();
}

export function getSuite(id: string): BenchmarkSuite | undefined {
  return db.select().from(benchmarkSuites).where(eq(benchmarkSuites.id, id)).get();
}

export function createSuite(input: {
  name: string;
  description: string;
  tasks: BenchTask[];
}): BenchmarkSuite {
  return db
    .insert(benchmarkSuites)
    .values({
      id: randomUUID(),
      name: input.name.trim().slice(0, 80) || "Custom suite",
      description: input.description.trim(),
      builtin: false,
      tasks: JSON.stringify(input.tasks),
    })
    .returning()
    .get();
}

export function updateSuite(
  id: string,
  input: { name: string; description: string; tasks: BenchTask[] },
): BenchmarkSuite | undefined {
  const existing = getSuite(id);
  if (!existing || existing.builtin) return undefined;
  return db
    .update(benchmarkSuites)
    .set({
      name: input.name.trim().slice(0, 80) || "Custom suite",
      description: input.description.trim(),
      tasks: JSON.stringify(input.tasks),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(benchmarkSuites.id, id))
    .returning()
    .get();
}

export function deleteSuite(id: string): void {
  const existing = getSuite(id);
  if (!existing || existing.builtin) return;
  db.delete(benchmarkSuites).where(eq(benchmarkSuites.id, id)).run();
}

/** Parses a suite's (or run snapshot's) task JSON; corrupt rows yield []. */
export function loadTasks(row: { tasks: string }): BenchTask[] {
  try {
    const parsed = JSON.parse(row.tasks) as unknown;
    return Array.isArray(parsed) ? (parsed as BenchTask[]) : [];
  } catch {
    return [];
  }
}

// --- runs ---

export function listRuns(): BenchmarkRun[] {
  return db.select().from(benchmarkRuns).orderBy(desc(benchmarkRuns.createdAt)).all();
}

export function getRun(id: string): BenchmarkRun | undefined {
  return db.select().from(benchmarkRuns).where(eq(benchmarkRuns.id, id)).get();
}

/** Timing of the discarded warmup request, per model. */
export interface ColdStart {
  latencyMs: number;
  ttftMs: number | null;
}

export function loadColdStarts(run: BenchmarkRun): Record<string, ColdStart> {
  try {
    const parsed = JSON.parse(run.coldStarts) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, ColdStart>)
      : {};
  } catch {
    return {};
  }
}

export function loadModels(run: BenchmarkRun): string[] {
  try {
    const parsed = JSON.parse(run.models) as unknown;
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
}

export function createRun(input: {
  suite: BenchmarkSuite;
  models: string[];
  title?: string;
  /** Sampling temperature for every request; defaults to 0 for reproducibility. */
  temperature?: number;
  /** Samples per task per model; more samples narrow the confidence interval. */
  repeats?: number;
}): BenchmarkRun {
  const models = [...new Set(input.models.map((m) => m.trim()).filter(Boolean))].slice(
    0,
    MAX_MODELS_PER_RUN,
  );
  const rate = getSettings().computeCostPerHour;
  return db
    .insert(benchmarkRuns)
    .values({
      id: randomUUID(),
      title:
        input.title?.trim().slice(0, 80) ||
        `${input.suite.name} — ${models.length} model${models.length === 1 ? "" : "s"}`,
      suiteId: input.suite.id,
      suiteName: input.suite.name,
      models: JSON.stringify(models),
      tasks: input.suite.tasks,
      status: "pending",
      costPerHour: rate > 0 ? rate : null,
      temperature: clampTemperature(input.temperature),
      repeats: clampRepeats(input.repeats),
    })
    .returning()
    .get();
}

function updateRun(
  id: string,
  set: Partial<
    Pick<
      BenchmarkRun,
      "status" | "error" | "title" | "startedAt" | "finishedAt" | "coldStarts"
    >
  >,
): void {
  db.update(benchmarkRuns)
    .set({ ...set, updatedAt: new Date().toISOString() })
    .where(eq(benchmarkRuns.id, id))
    .run();
}

export function renameRun(id: string, title: string): void {
  const trimmed = title.trim().slice(0, 80);
  if (trimmed) updateRun(id, { title: trimmed });
}

export function deleteRun(id: string): void {
  db.delete(benchmarkRuns).where(eq(benchmarkRuns.id, id)).run();
}

/** Requests cancellation; the executor checks between tasks. */
export function cancelRun(id: string): void {
  const run = getRun(id);
  if (run && (run.status === "running" || run.status === "pending")) {
    updateRun(id, { status: "cancelled", finishedAt: new Date().toISOString() });
  }
}

export function listResults(runId: string): BenchmarkResult[] {
  return db.select().from(benchmarkResults).where(eq(benchmarkResults.runId, runId)).all();
}

interface ResultInput {
  runId: string;
  model: string;
  taskIndex: number;
  repeatIndex: number;
  output: string;
  score: number;
  passed: boolean;
  latencyMs: number;
  ttftMs?: number | null;
  phases?: LatencyPhases | null;
  interTokenP50Ms?: number | null;
  interTokenP95Ms?: number | null;
  streamChunks?: number | null;
  outputTokens?: number | null;
  promptTokens?: number | null;
  tokensPerSecond?: number | null;
  prefillTokensPerSecond?: number | null;
  error?: string | null;
}

function insertResult(input: ResultInput): void {
  const { phases, ...rest } = input;
  db.insert(benchmarkResults)
    .values({
      id: randomUUID(),
      ...rest,
      output: input.output.slice(0, OUTPUT_STORE_MAX),
      ttftMs: input.ttftMs ?? null,
      encodeMs: phases ? Math.round(phases.encode) : null,
      queueMs: phases ? Math.round(phases.queue) : null,
      prefillMs: phases ? Math.round(phases.prefill) : null,
      decodeMs: phases ? Math.round(phases.decode) : null,
      interTokenP50Ms: input.interTokenP50Ms ?? null,
      interTokenP95Ms: input.interTokenP95Ms ?? null,
      streamChunks: input.streamChunks ?? null,
      outputTokens: input.outputTokens ?? null,
      promptTokens: input.promptTokens ?? null,
      tokensPerSecond: input.tokensPerSecond ?? null,
      prefillTokensPerSecond: input.prefillTokensPerSecond ?? null,
      error: input.error ?? null,
    })
    .run();
}

// --- execution ---

const JUDGE_SYSTEM =
  "You are a strict evaluator. Score how well a model's response fulfills a task, " +
  "comparing it to the reference answer when one is given. " +
  'Respond with ONLY a JSON object: {"score": <integer 0-10>}. 10 = fully correct and compliant, 0 = wrong or ignored the task.';

async function judgeOutput(task: BenchTask, output: string): Promise<TaskScore> {
  const { model, modelId } = getUtilityModel();
  if (!modelId) {
    return { score: 0, passed: false, error: "Judge unavailable: no model configured." };
  }
  const prompt =
    `TASK GIVEN TO THE MODEL:\n${task.prompt}\n\n` +
    (task.expected ? `REFERENCE ANSWER:\n${task.expected}\n\n` : "") +
    `MODEL'S RESPONSE:\n${output.slice(0, 4_000)}\n\nScore the response.`;
  const { text } = await generateText({
    model,
    system: JUDGE_SYSTEM,
    prompt,
    // A grader that changes its mind between runs is worse than no grader.
    temperature: 0,
    abortSignal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
  });
  const match = text.match(/"score"\s*:\s*(\d+(?:\.\d+)?)/) ?? text.match(/\b(\d+(?:\.\d+)?)\b/);
  if (!match) {
    return { score: 0, passed: false, error: "Judge returned no score." };
  }
  const score = Math.min(Math.max(Number(match[1]), 0), 10) / 10;
  return { score, passed: score >= 0.6 };
}

interface TaskMetrics {
  /** Full stored transcript (turn-labelled when multi-turn). */
  output: string;
  /** The last assistant reply — what the scorer sees. */
  finalText: string;
  latencyMs: number;
  ttftMs: number | null;
  /** encode + queue + prefill + decode, summed over turns; adds up to `latencyMs`. */
  phases: LatencyPhases | null;
  promptTokens: number | null;
  outputTokens: number | null;
  tokensPerSecond: number | null;
  prefillTokensPerSecond: number | null;
  interTokenP50Ms: number | null;
  interTokenP95Ms: number | null;
  streamChunks: number;
}

/** Timestamps written by the instrumented fetch of a single request. */
interface RequestProbe {
  /** When the HTTP request left the app (the prompt is serialized by then). */
  dispatchedAt: number | null;
  /** When the response headers arrived — the server has taken the work. */
  respondedAt: number | null;
}

/**
 * A fetch that timestamps the request boundary. On an SDK retry the later
 * attempt overwrites the earlier one, which is what we want: the phases then
 * describe the attempt that actually produced the answer.
 */
function probingFetch(probe: RequestProbe): typeof globalThis.fetch {
  return async (input, init) => {
    probe.dispatchedAt = Date.now();
    const response = await globalThis.fetch(input, init);
    probe.respondedAt = Date.now();
    return response;
  };
}

/** Builds a model bound to one request probe; a fresh probe per turn. */
type ModelFactory = (probe: RequestProbe) => LanguageModel;

/** Minimum inter-token gaps before the p50/p95 pair is worth reporting. */
const MIN_ITL_SAMPLES = 4;

const addPhases = (a: LatencyPhases, b: LatencyPhases): LatencyPhases => ({
  encode: a.encode + b.encode,
  queue: a.queue + b.queue,
  prefill: a.prefill + b.prefill,
  decode: a.decode + b.decode,
});

/**
 * Streams every turn of a task, splitting each request into four measured phases
 * that sum to its wall clock:
 *
 * - **encode** — `streamText` call → request dispatched: message conversion and
 *   JSON serialization, all client-side.
 * - **queue** — dispatch → response headers: transport plus the server accepting
 *   and queueing the request.
 * - **prefill** — headers → first output token: the server evaluating the prompt.
 * - **decode** — first output token → end of the response.
 *
 * Generation speed counts decode time only; prefill throughput comes from the
 * first turn alone, because follow-up turns usually hit the server's prefix
 * cache and would flatter the number. Inter-token gaps are pooled across turns.
 */
async function streamTask(
  factory: ModelFactory,
  task: BenchTask,
  temperature: number,
): Promise<TaskMetrics> {
  const turns = [task.prompt, ...(task.followups ?? [])].map((t) => t.trim()).filter(Boolean);
  if (turns.length === 0) throw new Error("Task has no prompt.");

  const messages: ModelMessage[] = [];
  const transcript: string[] = [];
  const gaps: number[] = [];
  let finalText = "";
  let latencyMs = 0;
  let phases: LatencyPhases = { encode: 0, queue: 0, prefill: 0, decode: 0 };
  let anyPhases = false;
  let ttftMs: number | null = null;
  let promptTokens: number | null = null;
  let outputTokens: number | null = null;
  let prefillTokensPerSecond: number | null = null;
  let streamChunks = 0;

  for (const [turnIndex, turn] of turns.entries()) {
    messages.push({ role: "user", content: turn });
    const probe: RequestProbe = { dispatchedAt: null, respondedAt: null };
    const startedAt = Date.now();
    let firstTokenAt: number | null = null;
    let lastChunkAt: number | null = null;
    let text = "";

    const result = streamText({
      model: factory(probe),
      system: BENCH_SYSTEM,
      messages,
      temperature,
      // Headroom for reasoning models: the built-in suites are hard enough that
      // a chain of thought is expected, and a truncated one loses the trailing
      // "Answer:" line and scores zero — measuring the cap, not the model.
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(TASK_TIMEOUT_MS),
      onError: () => {}, // surfaced as an error part in the loop below
    });
    for await (const part of result.fullStream) {
      if (part.type === "text-delta" || part.type === "reasoning-delta") {
        const now = Date.now();
        if (firstTokenAt === null) firstTokenAt = now;
        else if (lastChunkAt !== null) gaps.push(now - lastChunkAt);
        lastChunkAt = now;
        streamChunks++;
        if (part.type === "text-delta") text += part.text;
      } else if (part.type === "abort") {
        throw new Error(`Timed out after ${TASK_TIMEOUT_MS / 1000}s.`);
      } else if (part.type === "error") {
        throw part.error instanceof Error ? part.error : new Error(String(part.error));
      }
    }
    const usage = await result.usage;

    const turnLatency = Date.now() - startedAt;
    const turnTtft = firstTokenAt !== null ? firstTokenAt - startedAt : null;
    latencyMs += turnLatency;

    if (turnTtft !== null && firstTokenAt !== null) {
      // Clamp both boundaries inside the turn, so the four phases stay
      // non-negative and still add up to the turn's wall clock.
      const dispatchedAt = Math.min(probe.dispatchedAt ?? startedAt, firstTokenAt);
      const respondedAt = Math.min(
        Math.max(probe.respondedAt ?? dispatchedAt, dispatchedAt),
        firstTokenAt,
      );
      const encode = dispatchedAt - startedAt;
      const queue = respondedAt - dispatchedAt;
      const turnPhases: LatencyPhases = {
        encode,
        queue,
        prefill: turnTtft - encode - queue,
        decode: turnLatency - turnTtft,
      };
      phases = addPhases(phases, turnPhases);
      anyPhases = true;
      if (turnIndex === 0) {
        ttftMs = turnTtft;
        if (usage.inputTokens !== undefined && turnPhases.prefill >= 1) {
          prefillTokensPerSecond = usage.inputTokens / (turnPhases.prefill / 1000);
        }
      }
    } else if (turnIndex === 0) {
      ttftMs = turnTtft;
    }

    if (usage.inputTokens !== undefined) promptTokens = (promptTokens ?? 0) + usage.inputTokens;
    if (usage.outputTokens !== undefined) outputTokens = (outputTokens ?? 0) + usage.outputTokens;

    finalText = text;
    transcript.push(turns.length > 1 ? `— turn ${turnIndex + 1} —\n${text}` : text);
    messages.push({ role: "assistant", content: text });
  }

  const decodeSeconds = (anyPhases && phases.decode > 0 ? phases.decode : latencyMs) / 1000;
  return {
    output: transcript.join("\n\n"),
    finalText,
    latencyMs,
    ttftMs,
    phases: anyPhases ? phases : null,
    promptTokens,
    outputTokens,
    tokensPerSecond: outputTokens && decodeSeconds > 0 ? outputTokens / decodeSeconds : null,
    prefillTokensPerSecond,
    interTokenP50Ms: gaps.length >= MIN_ITL_SAMPLES ? percentile(gaps, 0.5) : null,
    interTokenP95Ms: gaps.length >= MIN_ITL_SAMPLES ? percentile(gaps, 0.95) : null,
    streamChunks,
  };
}

/** A trivial request, so the warmup costs as little generation time as possible. */
const WARMUP_TASK: BenchTask = {
  name: "warmup",
  category: "warmup",
  prompt: "Reply with only the word: ready",
  scoring: "timing",
};

/**
 * Sends one throwaway request before any task is timed.
 *
 * A local server loads model weights on first use, and with several models in a
 * run it may unload one to make room for the next. That load lands entirely in
 * the first timed request, inflating that model's latency, TTFT and prefill by
 * seconds — invisibly, because the number still looks like a plausible
 * measurement. Discarding one request removes it from every average; the cost
 * of the load is worth reporting on its own, so it is returned rather than
 * thrown away.
 */
async function warmUp(
  factory: ModelFactory,
  temperature: number,
): Promise<ColdStart | null> {
  try {
    const metrics = await streamTask(factory, WARMUP_TASK, temperature);
    return { latencyMs: metrics.latencyMs, ttftMs: metrics.ttftMs };
  } catch {
    // A failing warmup is not itself a result — the tasks that follow will
    // record the real error against the cells the user can see.
    return null;
  }
}

/**
 * Runs every model × task combination sequentially (one request at a time, so
 * latency and tokens/sec stay uncontended — important for local servers that
 * serve a single model). Results are written to the DB as they complete; the
 * UI polls. Checks for cancellation between tasks.
 */
export async function executeRun(runId: string): Promise<void> {
  const run = getRun(runId);
  if (!run || run.status !== "pending") return;
  const tasks = loadTasks(run);
  const models = loadModels(run);
  if (tasks.length === 0 || models.length === 0) {
    updateRun(runId, { status: "error", error: "The run has no tasks or no models." });
    return;
  }

  updateRun(runId, {
    status: "running",
    error: null,
    startedAt: new Date().toISOString(),
  });

  const coldStarts: Record<string, ColdStart> = {};

  try {
    for (const modelName of models) {
      // Resolve once to surface configuration errors, then rebuild per turn so
      // every request carries its own timing probe.
      let built: { factory: ModelFactory } | { error: string };
      try {
        const { modelId } = getChatModel(modelName);
        built = modelId
          ? { factory: (probe) => getChatModel(modelName, { fetch: probingFetch(probe) }).model }
          : { error: "Empty model id." };
      } catch (err) {
        built = { error: err instanceof Error ? err.message : "Failed to build the model." };
      }

      if (!("error" in built)) {
        const cold = await warmUp(built.factory, run.temperature);
        if (cold) {
          coldStarts[modelName] = cold;
          updateRun(runId, { coldStarts: JSON.stringify(coldStarts) });
        }
      }

      for (let i = 0; i < tasks.length; i++) {
        for (let rep = 0; rep < run.repeats; rep++) {
        const current = getRun(runId);
        if (!current || current.status === "cancelled") return;

        if ("error" in built) {
          insertResult({
            runId,
            model: modelName,
            taskIndex: i,
            repeatIndex: rep,
            output: "",
            score: 0,
            passed: false,
            latencyMs: 0,
            error: built.error,
          });
          continue;
        }

        const task = tasks[i];
        const startedAt = Date.now();
        try {
          const metrics = await streamTask(built.factory, task, run.temperature);
          const scored =
            task.scoring === "judge"
              ? await judgeOutput(task, metrics.finalText).catch(
                  (err): TaskScore => ({
                    score: 0,
                    passed: false,
                    error: `Judge failed: ${err instanceof Error ? err.message : String(err)}`,
                  }),
                )
              : scoreDeterministic(task, metrics.finalText);
          insertResult({
            runId,
            model: modelName,
            taskIndex: i,
            repeatIndex: rep,
            output: metrics.output,
            score: scored.score,
            passed: scored.passed,
            latencyMs: metrics.latencyMs,
            ttftMs: metrics.ttftMs,
            phases: metrics.phases,
            interTokenP50Ms: metrics.interTokenP50Ms,
            interTokenP95Ms: metrics.interTokenP95Ms,
            streamChunks: metrics.streamChunks,
            outputTokens: metrics.outputTokens,
            promptTokens: metrics.promptTokens,
            tokensPerSecond: metrics.tokensPerSecond,
            prefillTokensPerSecond: metrics.prefillTokensPerSecond,
            error: scored.error ?? null,
          });
        } catch (err) {
          insertResult({
            runId,
            model: modelName,
            taskIndex: i,
            repeatIndex: rep,
            output: "",
            score: 0,
            passed: false,
            latencyMs: Date.now() - startedAt,
            error: err instanceof Error ? err.message : "Request failed.",
          });
        }
        }
      }
    }

    const final = getRun(runId);
    if (final?.status === "running") {
      updateRun(runId, { status: "done", finishedAt: new Date().toISOString() });
    }
  } catch (err) {
    updateRun(runId, {
      status: "error",
      error: err instanceof Error ? err.message : "Benchmark execution failed.",
      finishedAt: new Date().toISOString(),
    });
  }
}

// --- aggregation ---

const mean = (values: number[]): number | null =>
  values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

const positives = (values: (number | null)[]): number[] =>
  values.filter((v): v is number => v !== null && v > 0);

const sumOrNull = (values: (number | null)[]): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? present.reduce((sum, v) => sum + v, 0) : null;
};

/** Reads the four phase columns off a row; null unless all four were recorded. */
function rowPhases(r: BenchmarkResult): LatencyPhases | null {
  const { encodeMs, queueMs, prefillMs, decodeMs } = r;
  if (encodeMs === null || queueMs === null || prefillMs === null || decodeMs === null) {
    return null;
  }
  return { encode: encodeMs, queue: queueMs, prefill: prefillMs, decode: decodeMs };
}

/** Mean ms per phase across the rows that recorded a split; null when none did. */
function averagePhases(rows: BenchmarkResult[]): LatencyPhases | null {
  const split = rows.map(rowPhases).filter((p): p is LatencyPhases => p !== null);
  if (split.length === 0) return null;
  const avg = (pick: (p: LatencyPhases) => number) =>
    split.reduce((sum, p) => sum + pick(p), 0) / split.length;
  return {
    encode: avg((p) => p.encode),
    queue: avg((p) => p.queue),
    prefill: avg((p) => p.prefill),
    decode: avg((p) => p.decode),
  };
}

/**
 * Time per output token: total decode time ÷ total output tokens, over the rows
 * that have both. The reciprocal of decode throughput, in the units a reader
 * feels ("~24 ms between tokens").
 */
function tpotMs(rows: BenchmarkResult[]): number | null {
  let decode = 0;
  let tokens = 0;
  for (const r of rows) {
    if (r.decodeMs === null || r.outputTokens === null || r.outputTokens <= 0) continue;
    decode += r.decodeMs;
    tokens += r.outputTokens;
  }
  return tokens > 0 ? decode / tokens : null;
}

/** Aggregates the per-cell inter-token gaps into one median/tail pair. */
function interTokenSummary(rows: BenchmarkResult[]): { p50: number; p95: number } | null {
  const p50 = positives(rows.map((r) => r.interTokenP50Ms));
  if (p50.length === 0) return null;
  const p95 = positives(rows.map((r) => r.interTokenP95Ms));
  return { p50: mean(p50) ?? 0, p95: mean(p95) ?? mean(p50) ?? 0 };
}

/** Builds the full comparison view (leaderboard, categories, task matrix) for a run. */
export function summarizeRun(run: BenchmarkRun, results: BenchmarkResult[]): RunSummaryView {
  const models = loadModels(run);
  const tasks = loadTasks(run);
  const labels = modelLabels(models);
  const available = availableProviders(getSettings());
  const coldStarts = loadColdStarts(run);
  // A cell can now hold several samples, so group rather than overwrite.
  const byKey = new Map<string, BenchmarkResult[]>();
  for (const r of results) {
    const key = `${r.model} ${r.taskIndex}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(r);
    else byKey.set(key, [r]);
  }
  const cell = (task: BenchTask, model: string, taskIndex: number): TaskCellView | null => {
    const rows = byKey.get(`${model} ${taskIndex}`);
    if (!rows || rows.length === 0) return null;
    const sorted = [...rows].sort((a, b) => a.repeatIndex - b.repeatIndex);
    const r = sorted[0];
    const passCount = sorted.filter((x) => x.passed).length;
    const avg = (pick: (x: BenchmarkResult) => number | null): number | null => {
      const vals = sorted.map(pick).filter((v): v is number => v !== null);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    return {
      output: r.output,
      score: sorted.reduce((sum, x) => sum + x.score, 0) / sorted.length,
      // With repeats the glyph reflects the majority; the exact split is shown
      // alongside it, so a 3/5 never masquerades as a clean pass.
      passed: passCount * 2 > sorted.length,
      samples: sorted.length,
      passCount,
      failures: sorted
        .map((x) => classifyFailure(task, x, MAX_OUTPUT_TOKENS))
        .filter((kind): kind is FailureKind => kind !== null),
      latencyMs: avg((x) => x.latencyMs) ?? r.latencyMs,
      ttftMs: avg((x) => x.ttftMs),
      tokensPerSecond: avg((x) => x.tokensPerSecond),
      prefillTokensPerSecond: avg((x) => x.prefillTokensPerSecond),
      phases: rowPhases(r),
      interTokenP50Ms: avg((x) => x.interTokenP50Ms),
      interTokenP95Ms: avg((x) => x.interTokenP95Ms),
      promptTokens: r.promptTokens,
      outputTokens: r.outputTokens,
      error: sorted.find((x) => x.error !== null)?.error ?? null,
    };
  };

  const taskRows = tasks.map((task, index) => ({
    index,
    name: task.name,
    category: task.category,
    scoring: task.scoring,
    expected: task.expected,
    prompt: task.prompt,
    cells: models.map((m) => cell(task, m, index)),
  }));

  const modelSummaries: ModelSummary[] = models.map((model, mi) => {
    const rows = results.filter((r) => r.model === model);
    const scored = rows.filter((r) => {
      const scoring = tasks[r.taskIndex]?.scoring;
      return scoring !== undefined && !isTimingOnly(scoring);
    });
    const latency = describe(positives(rows.map((r) => r.latencyMs)));
    const ttft = describe(positives(rows.map((r) => r.ttftMs)));
    const decodeSpeed = describe(positives(rows.map((r) => r.tokensPerSecond)));
    return {
      model,
      provider: parseModel(model, available).provider,
      label: labels[mi],
      score: mean(scored.map((r) => r.score)) ?? 0,
      passed: scored.filter((r) => r.passed).length,
      // Over every scored *sample*, not every task — repeats are what make the
      // interval narrow enough to read a ranking from.
      accuracy: wilson(scored.filter((r) => r.passed).length, scored.length),
      repeats: run.repeats,
      scoredCompleted: scored.length,
      completed: rows.length,
      errors: rows.filter((r) => r.error !== null).length,
      avgLatencyMs: latency?.mean ?? null,
      avgTtftMs: ttft?.mean ?? null,
      avgTokensPerSecond: decodeSpeed?.mean ?? null,
      avgPrefillTokensPerSecond: mean(positives(rows.map((r) => r.prefillTokensPerSecond))),
      totalLatencyMs: rows.reduce((sum, r) => sum + r.latencyMs, 0),
      totalOutputTokens: sumOrNull(rows.map((r) => r.outputTokens)),
      totalPromptTokens: sumOrNull(rows.map((r) => r.promptTokens)),
      phases: averagePhases(rows),
      latency,
      ttft,
      decodeSpeed,
      interToken: interTokenSummary(rows),
      avgTpotMs: tpotMs(rows),
      coldStartMs: coldStarts[model]?.latencyMs ?? null,
    };
  });

  // Accuracy-by-category only covers scored tasks — timing probes have no accuracy.
  const scoredCategories = [
    ...new Set(tasks.filter((t) => !isTimingOnly(t.scoring)).map((t) => t.category)),
  ];
  const categories: CategorySummary[] = scoredCategories.map((category) => ({
    category,
    scores: models.map((_, mi) => {
      const scores = taskRows
        .filter((row) => row.category === category && !isTimingOnly(row.scoring))
        .map((row) => row.cells[mi])
        .filter((c): c is TaskCellView => c !== null)
        .map((c) => c.score);
      const avg = mean(scores);
      return avg === null ? null : avg * 100;
    }),
  }));

  return {
    models: modelSummaries,
    categories,
    tasks: taskRows,
    completed: results.length,
    total: models.length * tasks.length * Math.max(run.repeats, 1),
  };
}

/**
 * Per-model aggregates of every run that produced results, oldest first — the
 * data behind the History tab's over-time charts and table. Cost estimates use
 * the run's snapshotted $/hour, falling back to the current setting for runs
 * made before a rate was configured.
 */
export function historyView(): HistoryEntry[] {
  const settingsRate = getSettings().computeCostPerHour;
  const entries: HistoryEntry[] = [];
  for (const run of [...listRuns()].reverse()) {
    const results = listResults(run.id);
    if (results.length === 0) continue;
    const summary = summarizeRun(run, results);
    const rate = run.costPerHour ?? (settingsRate > 0 ? settingsRate : null);
    for (const m of summary.models) {
      if (m.completed === 0) continue;
      entries.push({
        runId: run.id,
        runTitle: run.title,
        suiteId: run.suiteId,
        suiteName: run.suiteName,
        status: run.status,
        createdAt: run.createdAt,
        model: m.model,
        score: m.scoredCompleted > 0 ? m.score : null,
        avgLatencyMs: m.avgLatencyMs,
        avgTtftMs: m.avgTtftMs,
        avgTokensPerSecond: m.avgTokensPerSecond,
        avgPrefillTokensPerSecond: m.avgPrefillTokensPerSecond,
        phases: m.phases,
        avgTpotMs: m.avgTpotMs,
        p95LatencyMs: m.latency?.p95 ?? null,
        latencyCv: m.latency !== null && m.latency.count > 1 ? m.latency.cv : null,
        totalLatencyMs: m.totalLatencyMs,
        totalOutputTokens: m.totalOutputTokens,
        totalPromptTokens: m.totalPromptTokens,
        costPerHour: rate,
        estimatedCost: rate !== null ? costOfMs(m.totalLatencyMs, rate) : null,
      });
    }
  }
  return entries;
}
