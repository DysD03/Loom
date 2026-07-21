"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SCORING_KINDS, SCORING_LABELS, type BenchTask } from "@/lib/benchmark-score";
import {
  createSuiteAction,
  updateSuiteAction,
  type SuiteTaskInput,
} from "@/app/benchmarks/actions";

const EXPECTED_PLACEHOLDER: Record<string, string> = {
  exact: "The exact reply, e.g. OK",
  contains: "Text the reply must contain",
  numeric: "The number, e.g. 42",
  regex: "Pattern, e.g. ^yes$",
  mcq: "The letter, e.g. B",
  json: 'JSON to match, e.g. {"ok":true}',
  judge: "Reference answer for the judge (optional)",
};

const emptyTask = (): SuiteTaskInput => ({
  name: "",
  category: "",
  prompt: "",
  followups: [],
  scoring: "contains",
  expected: "",
});

export function SuiteEditor({
  suite,
  onDone,
}: {
  /** Absent for a new suite. */
  suite?: { id: string; name: string; description: string; tasks: BenchTask[] };
  onDone: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(suite?.name ?? "");
  const [description, setDescription] = useState(suite?.description ?? "");
  const [tasks, setTasks] = useState<SuiteTaskInput[]>(
    suite && suite.tasks.length > 0
      ? suite.tasks.map((t) => ({
          name: t.name,
          category: t.category,
          prompt: t.prompt,
          followups: t.followups ?? [],
          scoring: t.scoring,
          expected: t.expected ?? "",
        }))
      : [emptyTask()],
  );

  function patchTask(index: number, patch: Partial<SuiteTaskInput>) {
    setTasks((prev) => prev.map((task, i) => (i === index ? { ...task, ...patch } : task)));
  }

  function patchFollowup(index: number, turnIndex: number, value: string) {
    setTasks((prev) =>
      prev.map((task, i) =>
        i === index
          ? { ...task, followups: task.followups.map((f, fi) => (fi === turnIndex ? value : f)) }
          : task,
      ),
    );
  }

  function save() {
    startTransition(async () => {
      const result = suite
        ? await updateSuiteAction(suite.id, { name, description, tasks })
        : await createSuiteAction({ name, description, tasks });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(suite ? "Suite updated." : "Suite created.");
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="suite-name">Suite name</Label>
          <Input
            id="suite-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My eval"
            disabled={isPending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="suite-description">Description</Label>
          <Input
            id="suite-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this suite measures"
            disabled={isPending}
          />
        </div>
      </div>

      <div className="space-y-3">
        {tasks.map((task, i) => (
          <div key={i} className="bg-card/60 space-y-2 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Input
                value={task.name}
                onChange={(e) => patchTask(i, { name: e.target.value })}
                placeholder={`Task ${i + 1} name`}
                className="h-8 flex-1 text-xs"
                disabled={isPending}
              />
              <Input
                value={task.category}
                onChange={(e) => patchTask(i, { category: e.target.value })}
                placeholder="category"
                className="h-8 w-32 text-xs"
                disabled={isPending}
              />
              <Select
                value={task.scoring}
                onValueChange={(value) => value && patchTask(i, { scoring: value })}
                disabled={isPending}
              >
                <SelectTrigger size="sm" className="w-44" aria-label="Scoring method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCORING_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {SCORING_LABELS[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove task"
                onClick={() => setTasks((prev) => prev.filter((_, ti) => ti !== i))}
                disabled={isPending || tasks.length === 1}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <Textarea
              value={task.prompt}
              onChange={(e) => patchTask(i, { prompt: e.target.value })}
              placeholder={
                task.followups.length > 0 ? "Turn 1 — the opening prompt" : "The prompt sent to each model"
              }
              className="min-h-16 font-mono text-xs"
              disabled={isPending}
            />
            {task.followups.map((followup, fi) => (
              <div key={fi} className="flex items-start gap-2">
                <Textarea
                  value={followup}
                  onChange={(e) => patchFollowup(i, fi, e.target.value)}
                  placeholder={`Turn ${fi + 2} — sent after the model replies`}
                  className="min-h-12 flex-1 font-mono text-xs"
                  disabled={isPending}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove turn ${fi + 2}`}
                  onClick={() =>
                    patchTask(i, { followups: task.followups.filter((_, ri) => ri !== fi) })
                  }
                  disabled={isPending}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => patchTask(i, { followups: [...task.followups, ""] })}
                disabled={isPending}
                className="text-muted-foreground h-7 gap-1 px-2 text-xs"
              >
                <Plus className="size-3" />
                Add follow-up turn
              </Button>
              {task.followups.length > 0 ? (
                <span className="text-muted-foreground text-xs">
                  Multi-turn — only the final reply is scored.
                </span>
              ) : null}
            </div>
            {task.scoring === "timing" ? (
              <p className="text-muted-foreground text-xs">
                Timing only — no correctness check. Latency, TTFT, and tokens/sec are still
                recorded.
              </p>
            ) : (
              <Input
                value={task.expected}
                onChange={(e) => patchTask(i, { expected: e.target.value })}
                placeholder={EXPECTED_PLACEHOLDER[task.scoring]}
                className="h-8 font-mono text-xs"
                disabled={isPending}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setTasks((prev) => [...prev, emptyTask()])}
          disabled={isPending}
          className="gap-1.5"
        >
          <Plus className="size-3.5" />
          Add task
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={isPending} className="gap-1.5">
          {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save suite
        </Button>
      </div>
    </div>
  );
}
