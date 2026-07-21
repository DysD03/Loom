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
import { getChatModel, getUtilityModel } from "./provider";
import { getSettings } from "./settings";
import { costOfMs } from "./benchmark-cost";
import {
  isTimingOnly,
  modelLabels,
  scoreDeterministic,
  type BenchTask,
  type CategorySummary,
  type HistoryEntry,
  type ModelSummary,
  type RunSummaryView,
  type TaskCellView,
  type TaskScore,
} from "./benchmark-score";
import { BUILTIN_SUITES } from "./benchmark-suites";

export const MAX_MODELS_PER_RUN = 5;
const TASK_TIMEOUT_MS = 120_000;
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
    })
    .returning()
    .get();
}

function updateRun(
  id: string,
  set: Partial<Pick<BenchmarkRun, "status" | "error" | "title" | "startedAt" | "finishedAt">>,
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
  output: string;
  score: number;
  passed: boolean;
  latencyMs: number;
  ttftMs?: number | null;
  outputTokens?: number | null;
  promptTokens?: number | null;
  tokensPerSecond?: number | null;
  promptTokensPerSecond?: number | null;
  error?: string | null;
}

function insertResult(input: ResultInput): void {
  db.insert(benchmarkResults)
    .values({
      id: randomUUID(),
      ...input,
      output: input.output.slice(0, OUTPUT_STORE_MAX),
      ttftMs: input.ttftMs ?? null,
      outputTokens: input.outputTokens ?? null,
      promptTokens: input.promptTokens ?? null,
      tokensPerSecond: input.tokensPerSecond ?? null,
      promptTokensPerSecond: input.promptTokensPerSecond ?? null,
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
  promptTokens: number | null;
  outputTokens: number | null;
  tokensPerSecond: number | null;
  promptTokensPerSecond: number | null;
}

/**
 * Streams every turn of a task against a model, timing time-to-first-token
 * (first reasoning or text delta). Generation speed counts only post-TTFT time;
 * prompt-processing speed comes from the first turn alone, because follow-up
 * turns usually hit the server's prefix cache and would flatter the number.
 */
async function streamTask(model: LanguageModel, task: BenchTask): Promise<TaskMetrics> {
  const turns = [task.prompt, ...(task.followups ?? [])].map((t) => t.trim()).filter(Boolean);
  if (turns.length === 0) throw new Error("Task has no prompt.");

  const messages: ModelMessage[] = [];
  const transcript: string[] = [];
  let finalText = "";
  let latencyMs = 0;
  let generationMs = 0;
  let ttftMs: number | null = null;
  let promptTokens: number | null = null;
  let outputTokens: number | null = null;
  let promptTokensPerSecond: number | null = null;

  for (const [turnIndex, turn] of turns.entries()) {
    messages.push({ role: "user", content: turn });
    const startedAt = Date.now();
    let firstTokenAt: number | null = null;
    let text = "";

    const result = streamText({
      model,
      system: BENCH_SYSTEM,
      messages,
      maxOutputTokens: 2_048,
      abortSignal: AbortSignal.timeout(TASK_TIMEOUT_MS),
      onError: () => {}, // surfaced as an error part in the loop below
    });
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        firstTokenAt ??= Date.now();
        text += part.text;
      } else if (part.type === "reasoning-delta") {
        firstTokenAt ??= Date.now();
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
    generationMs += turnLatency - (turnTtft ?? 0);
    if (turnIndex === 0) {
      ttftMs = turnTtft;
      if (usage.inputTokens !== undefined && turnTtft !== null && turnTtft > 0) {
        promptTokensPerSecond = usage.inputTokens / (turnTtft / 1000);
      }
    }
    if (usage.inputTokens !== undefined) promptTokens = (promptTokens ?? 0) + usage.inputTokens;
    if (usage.outputTokens !== undefined) outputTokens = (outputTokens ?? 0) + usage.outputTokens;

    finalText = text;
    transcript.push(turns.length > 1 ? `— turn ${turnIndex + 1} —\n${text}` : text);
    messages.push({ role: "assistant", content: text });
  }

  const generationSeconds = (generationMs > 0 ? generationMs : latencyMs) / 1000;
  return {
    output: transcript.join("\n\n"),
    finalText,
    latencyMs,
    ttftMs,
    promptTokens,
    outputTokens,
    tokensPerSecond:
      outputTokens && generationSeconds > 0 ? outputTokens / generationSeconds : null,
    promptTokensPerSecond,
  };
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

  try {
    for (const modelName of models) {
      let built: { model: ReturnType<typeof getChatModel>["model"] } | { error: string };
      try {
        const { model, modelId } = getChatModel(modelName);
        built = modelId ? { model } : { error: "Empty model id." };
      } catch (err) {
        built = { error: err instanceof Error ? err.message : "Failed to build the model." };
      }

      for (let i = 0; i < tasks.length; i++) {
        const current = getRun(runId);
        if (!current || current.status === "cancelled") return;

        if ("error" in built) {
          insertResult({
            runId,
            model: modelName,
            taskIndex: i,
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
          const metrics = await streamTask(built.model, task);
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
            output: metrics.output,
            score: scored.score,
            passed: scored.passed,
            latencyMs: metrics.latencyMs,
            ttftMs: metrics.ttftMs,
            outputTokens: metrics.outputTokens,
            promptTokens: metrics.promptTokens,
            tokensPerSecond: metrics.tokensPerSecond,
            promptTokensPerSecond: metrics.promptTokensPerSecond,
            error: scored.error ?? null,
          });
        } catch (err) {
          insertResult({
            runId,
            model: modelName,
            taskIndex: i,
            output: "",
            score: 0,
            passed: false,
            latencyMs: Date.now() - startedAt,
            error: err instanceof Error ? err.message : "Request failed.",
          });
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

/** Builds the full comparison view (leaderboard, categories, task matrix) for a run. */
export function summarizeRun(run: BenchmarkRun, results: BenchmarkResult[]): RunSummaryView {
  const models = loadModels(run);
  const tasks = loadTasks(run);
  const labels = modelLabels(models);
  const byKey = new Map(results.map((r) => [`${r.model} ${r.taskIndex}`, r]));
  const cell = (model: string, taskIndex: number): TaskCellView | null => {
    const r = byKey.get(`${model} ${taskIndex}`);
    if (!r) return null;
    return {
      output: r.output,
      score: r.score,
      passed: r.passed,
      latencyMs: r.latencyMs,
      ttftMs: r.ttftMs,
      tokensPerSecond: r.tokensPerSecond,
      promptTokensPerSecond: r.promptTokensPerSecond,
      error: r.error,
    };
  };

  const taskRows = tasks.map((task, index) => ({
    index,
    name: task.name,
    category: task.category,
    scoring: task.scoring,
    expected: task.expected,
    prompt: task.prompt,
    cells: models.map((m) => cell(m, index)),
  }));

  const positives = (values: (number | null)[]): number[] =>
    values.filter((v): v is number => v !== null && v > 0);

  const modelSummaries: ModelSummary[] = models.map((model, mi) => {
    const rows = results.filter((r) => r.model === model);
    const scored = rows.filter((r) => {
      const scoring = tasks[r.taskIndex]?.scoring;
      return scoring !== undefined && !isTimingOnly(scoring);
    });
    const withOutputTokens = rows.filter((r) => r.outputTokens !== null);
    return {
      model,
      label: labels[mi],
      score: mean(scored.map((r) => r.score)) ?? 0,
      passed: scored.filter((r) => r.passed).length,
      scoredCompleted: scored.length,
      completed: rows.length,
      errors: rows.filter((r) => r.error !== null).length,
      avgLatencyMs: mean(positives(rows.map((r) => r.latencyMs))),
      avgTtftMs: mean(positives(rows.map((r) => r.ttftMs))),
      avgTokensPerSecond: mean(positives(rows.map((r) => r.tokensPerSecond))),
      avgPromptTokensPerSecond: mean(positives(rows.map((r) => r.promptTokensPerSecond))),
      totalLatencyMs: rows.reduce((sum, r) => sum + r.latencyMs, 0),
      totalOutputTokens:
        withOutputTokens.length > 0
          ? withOutputTokens.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0)
          : null,
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
    total: models.length * tasks.length,
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
        avgPromptTokensPerSecond: m.avgPromptTokensPerSecond,
        totalLatencyMs: m.totalLatencyMs,
        totalOutputTokens: m.totalOutputTokens,
        costPerHour: rate,
        estimatedCost: rate !== null ? costOfMs(m.totalLatencyMs, rate) : null,
      });
    }
  }
  return entries;
}
