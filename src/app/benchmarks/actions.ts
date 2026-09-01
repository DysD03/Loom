"use server";

import { revalidatePath } from "next/cache";

import {
  cancelRun,
  createSuite,
  deleteRun,
  deleteSuite,
  pinBaselineRun,
  renameRun,
  resumeRun,
  unpinBaselineRun,
  updateSuite,
} from "@/lib/benchmarks";
import { SCORING_KINDS, type BenchTask, type ScoringKind } from "@/lib/benchmark-score";

export interface SuiteTaskInput {
  name: string;
  category: string;
  prompt: string;
  /** Extra user turns sent after the first reply (multi-turn benchmarks). */
  followups: string[];
  scoring: string;
  expected: string;
}

function validateTasks(tasks: SuiteTaskInput[]): { tasks: BenchTask[] } | { error: string } {
  const cleaned: BenchTask[] = [];
  for (const [i, task] of tasks.entries()) {
    const prompt = task.prompt.trim();
    if (!prompt) continue;
    const scoring = (SCORING_KINDS as readonly string[]).includes(task.scoring)
      ? (task.scoring as ScoringKind)
      : "contains";
    const expected = task.expected.trim();
    if (!expected && scoring !== "judge" && scoring !== "timing") {
      return { error: `Task ${i + 1} needs an expected value for ${scoring} scoring.` };
    }
    if (scoring === "regex") {
      try {
        new RegExp(expected, "i");
      } catch {
        return { error: `Task ${i + 1} has an invalid regex.` };
      }
    }
    if (scoring === "json" && expected) {
      try {
        JSON.parse(expected);
      } catch {
        return { error: `Task ${i + 1}: expected value is not valid JSON.` };
      }
    }
    const followups = task.followups.map((t) => t.trim()).filter(Boolean);
    cleaned.push({
      name: task.name.trim() || `Task ${i + 1}`,
      category: task.category.trim().toLowerCase() || "custom",
      prompt,
      followups: followups.length > 0 ? followups : undefined,
      scoring,
      expected: expected || undefined,
    });
  }
  if (cleaned.length === 0) {
    return { error: "Add at least one task with a prompt." };
  }
  return { tasks: cleaned };
}

export async function createSuiteAction(input: {
  name: string;
  description: string;
  tasks: SuiteTaskInput[];
}): Promise<{ id: string } | { error: string }> {
  const validated = validateTasks(input.tasks);
  if ("error" in validated) return validated;
  const suite = createSuite({
    name: input.name,
    description: input.description,
    tasks: validated.tasks,
  });
  revalidatePath("/benchmarks");
  return { id: suite.id };
}

export async function updateSuiteAction(
  id: string,
  input: { name: string; description: string; tasks: SuiteTaskInput[] },
): Promise<{ ok: true } | { error: string }> {
  const validated = validateTasks(input.tasks);
  if ("error" in validated) return validated;
  const updated = updateSuite(id, {
    name: input.name,
    description: input.description,
    tasks: validated.tasks,
  });
  if (!updated) return { error: "Suite not found (built-in suites can't be edited)." };
  revalidatePath("/benchmarks");
  return { ok: true };
}

export async function deleteSuiteAction(id: string): Promise<void> {
  deleteSuite(id);
  revalidatePath("/benchmarks");
}

export async function cancelRunAction(id: string): Promise<void> {
  cancelRun(id);
  revalidatePath("/benchmarks");
}

/** Restarts a cancelled or failed run, skipping the cells it already finished. */
export async function resumeRunAction(id: string): Promise<{ ok: boolean }> {
  const ok = resumeRun(id);
  revalidatePath("/benchmarks");
  return { ok };
}

/** Pins this run as the comparison baseline, or clears the pin when id is null. */
export async function setBaselineAction(id: string | null): Promise<void> {
  if (id) pinBaselineRun(id);
  else unpinBaselineRun();
  revalidatePath("/benchmarks");
}

export async function renameRunAction(id: string, title: string): Promise<void> {
  renameRun(id, title);
  revalidatePath("/benchmarks");
}

export async function deleteRunAction(id: string): Promise<void> {
  deleteRun(id);
  revalidatePath("/benchmarks");
}
