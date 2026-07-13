import "server-only";

import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { generateText } from "ai";

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
import {
  modelLabels,
  scoreDeterministic,
  type BenchTask,
  type CategorySummary,
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
    })
    .returning()
    .get();
}

function updateRun(
  id: string,
  set: Partial<Pick<BenchmarkRun, "status" | "error" | "title">>,
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
    updateRun(id, { status: "cancelled" });
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
  outputTokens?: number | null;
  tokensPerSecond?: number | null;
  error?: string | null;
}

function insertResult(input: ResultInput): void {
  db.insert(benchmarkResults)
    .values({
      id: randomUUID(),
      ...input,
      output: input.output.slice(0, OUTPUT_STORE_MAX),
      outputTokens: input.outputTokens ?? null,
      tokensPerSecond: input.tokensPerSecond ?? null,
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

  updateRun(runId, { status: "running", error: null });

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
          const { text, usage } = await generateText({
            model: built.model,
            system: BENCH_SYSTEM,
            prompt: task.prompt,
            maxOutputTokens: 2_048,
            abortSignal: AbortSignal.timeout(TASK_TIMEOUT_MS),
          });
          const latencyMs = Date.now() - startedAt;
          const scored =
            task.scoring === "judge"
              ? await judgeOutput(task, text).catch(
                  (err): TaskScore => ({
                    score: 0,
                    passed: false,
                    error: `Judge failed: ${err instanceof Error ? err.message : String(err)}`,
                  }),
                )
              : scoreDeterministic(task, text);
          const outputTokens = usage.outputTokens ?? null;
          insertResult({
            runId,
            model: modelName,
            taskIndex: i,
            output: text,
            score: scored.score,
            passed: scored.passed,
            latencyMs,
            outputTokens,
            tokensPerSecond:
              outputTokens && latencyMs > 0 ? outputTokens / (latencyMs / 1000) : null,
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
      updateRun(runId, { status: "done" });
    }
  } catch (err) {
    updateRun(runId, {
      status: "error",
      error: err instanceof Error ? err.message : "Benchmark execution failed.",
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
      tokensPerSecond: r.tokensPerSecond,
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

  const modelSummaries: ModelSummary[] = models.map((model, mi) => {
    const cells = taskRows.map((row) => row.cells[mi]).filter((c): c is TaskCellView => c !== null);
    const ok = cells.filter((c) => !c.error || c.latencyMs > 0);
    return {
      model,
      label: labels[mi],
      score: mean(cells.map((c) => c.score)) ?? 0,
      passed: cells.filter((c) => c.passed).length,
      completed: cells.length,
      errors: cells.filter((c) => c.error !== null).length,
      avgLatencyMs: mean(ok.filter((c) => c.latencyMs > 0).map((c) => c.latencyMs)),
      avgTokensPerSecond: mean(
        cells.map((c) => c.tokensPerSecond).filter((v): v is number => v !== null && v > 0),
      ),
    };
  });

  const categories: CategorySummary[] = [...new Set(tasks.map((t) => t.category))].map(
    (category) => ({
      category,
      scores: models.map((_, mi) => {
        const scores = taskRows
          .filter((row) => row.category === category)
          .map((row) => row.cells[mi])
          .filter((c): c is TaskCellView => c !== null)
          .map((c) => c.score);
        const avg = mean(scores);
        return avg === null ? null : avg * 100;
      }),
    }),
  );

  return {
    models: modelSummaries,
    categories,
    tasks: taskRows,
    completed: results.length,
    total: models.length * tasks.length,
  };
}
