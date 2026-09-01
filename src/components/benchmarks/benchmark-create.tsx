"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gauge, Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import type { BenchTask, HistoryEntry } from "@/lib/benchmark-score";
import { deleteSuiteAction } from "@/app/benchmarks/actions";
import { BenchmarkExport } from "./export";
import { BenchmarkHistory } from "./history";
import { ModelPicker } from "./model-picker";
import { SuiteEditor } from "./suite-editor";

const MAX_MODELS = 5;

export interface SuiteView {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  tasks: BenchTask[];
}

/**
 * Reads "0, 0.4, 0.8" into sweep steps. Fewer than two distinct values is not a
 * sweep, so it yields [] and the run falls back to its single temperature.
 */
function parseSweep(value: string): number[] {
  const steps = [
    ...new Set(
      value
        .split(/[,\s]+/)
        .map((part) => Number(part))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 2),
    ),
  ].sort((a, b) => a - b);
  return steps.length > 1 ? steps.slice(0, 5) : [];
}

export function BenchmarkCreate({
  suites,
  history,
}: {
  suites: SuiteView[];
  history: HistoryEntry[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [suiteId, setSuiteId] = useState<string>(suites[0]?.id ?? "");
  const [models, setModels] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [temperature, setTemperature] = useState("0");
  const [sweep, setSweep] = useState("");
  const [probeConcurrency, setProbeConcurrency] = useState(false);
  const [repeats, setRepeats] = useState("1");
  const [starting, setStarting] = useState(false);
  /** null = list, "new" = creating, otherwise the suite id being edited. */
  const [editing, setEditing] = useState<string | null>(null);

  const sweepSteps = parseSweep(sweep);
  const selectedSuite = suites.find((s) => s.id === suiteId);
  const editingSuite = suites.find((s) => s.id === editing && !s.builtin);

  async function start() {
    if (!suiteId || models.length === 0) return;
    setStarting(true);
    try {
      const res = await fetch("/api/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suiteId,
          models,
          title: title.trim() || undefined,
          temperature: Number(temperature) || 0,
          repeats: Number(repeats) || 1,
          temperatures: parseSweep(sweep),
          probeConcurrency,
        }),
      });
      const data = (await res.json()) as { runId?: string; error?: string };
      if (!res.ok || !data.runId) {
        toast.error(data.error ?? "Failed to start the benchmark.");
        return;
      }
      router.push(`/benchmarks?r=${data.runId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start the benchmark.");
    } finally {
      setStarting(false);
    }
  }

  function removeSuite(id: string) {
    startTransition(async () => {
      await deleteSuiteAction(id);
      if (id === suiteId) setSuiteId(suites.find((s) => s.id !== id)?.id ?? "");
      router.refresh();
    });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="animate-fade-in-up mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
        <div className="space-y-3 text-center">
          <Gauge className="text-neon-cyan mx-auto size-9 drop-shadow-[0_0_10px_var(--neon-cyan)]" />
          <p className="font-pixel text-glow-magenta text-primary text-sm leading-relaxed">
            MODEL BENCHMARK
            <span className="bg-neon-cyan animate-blink ml-1 inline-block h-3 w-2 align-middle" />
          </p>
          <p className="text-muted-foreground text-sm">
            Race up to {MAX_MODELS} models — local or cloud — through a standardized or custom
            suite, then compare accuracy, speed, and per-category strengths.
          </p>
        </div>

        <Tabs defaultValue="run">
          <TabsList>
            <TabsTab value="run">Run benchmark</TabsTab>
            <TabsTab value="suites">Suites</TabsTab>
            <TabsTab value="history">History</TabsTab>
            <TabsTab value="export">Export PDF</TabsTab>
          </TabsList>

          <TabsPanel value="run" className="space-y-5 pt-2">
            <div className="space-y-1.5">
              <Label>Benchmark suite</Label>
              <Select
                value={suiteId || null}
                onValueChange={(value) => value && setSuiteId(value)}
                disabled={starting}
              >
                <SelectTrigger className="w-full" aria-label="Benchmark suite">
                  {/* Without a render function the trigger shows the raw suite id. */}
                  <SelectValue placeholder="Pick a suite">
                    {(value: string) =>
                      suites.find((suite) => suite.id === value)?.name ?? "Pick a suite"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {suites.map((suite) => (
                    <SelectItem key={suite.id} value={suite.id}>
                      {suite.name} ({suite.tasks.length} tasks{suite.builtin ? ", built-in" : ""})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedSuite?.description ? (
                <p className="text-muted-foreground text-xs">{selectedSuite.description}</p>
              ) : null}
            </div>

            <ModelPicker
              selected={models}
              onChange={setModels}
              max={MAX_MODELS}
              disabled={starting}
            />

            <div className="space-y-1.5">
              <Label htmlFor="run-title">Run title (optional)</Label>
              <Input
                id="run-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={selectedSuite ? `${selectedSuite.name} shootout` : "Benchmark run"}
                disabled={starting}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="run-repeats">Samples per task</Label>
              <Input
                id="run-repeats"
                type="number"
                min="1"
                max="10"
                step="1"
                className="w-32"
                value={repeats}
                onChange={(e) => setRepeats(e.target.value)}
                disabled={starting}
              />
              <p className="text-muted-foreground text-xs">
                One sample gives a score with no error bar, so a 70% and a 75% are
                indistinguishable. Running each task several times reports accuracy as a
                confidence interval and marks leaderboard gaps that are not real — at the cost
                of multiplying the run time.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="run-temperature">Temperature</Label>
              <Input
                id="run-temperature"
                type="number"
                min="0"
                max="2"
                step="0.1"
                className="w-32"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                disabled={starting}
              />
              <p className="text-muted-foreground text-xs">
                0 is greedy decoding, so re-running the same suite against the same model
                reproduces the same answers — the right default for comparing models. Raise it
                only to measure how much a model&apos;s accuracy moves with sampling.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="run-sweep">Temperature sweep</Label>
              <Input
                id="run-sweep"
                className="w-56"
                value={sweep}
                onChange={(e) => setSweep(e.target.value)}
                placeholder="e.g. 0, 0.4, 0.8"
                disabled={starting}
              />
              <p className="text-muted-foreground text-xs">
                {sweepSteps.length > 1
                  ? `Each model runs ${sweepSteps.length} times — once per step — and appears on the leaderboard as its own variant${
                      models.length > 0
                        ? `, ${models.length * sweepSteps.length} in total`
                        : ""
                    }. This overrides the single temperature above.`
                  : "Two or more values run each model once per temperature and compare the variants side by side — how much sampling actually costs this model on this suite. Leave empty to use the single temperature above."}
              </p>
            </div>

            <div className="space-y-1.5">
              <button
                type="button"
                role="switch"
                aria-checked={probeConcurrency}
                onClick={() => setProbeConcurrency((on) => !on)}
                disabled={starting}
                className={cn(
                  "flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
                  probeConcurrency
                    ? "border-neon-cyan/50 bg-neon-cyan/5"
                    : "border-border text-muted-foreground hover:bg-muted/50",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1 inline-block size-2.5 shrink-0 rounded-sm border",
                    probeConcurrency
                      ? "border-neon-cyan bg-neon-cyan"
                      : "border-muted-foreground/50",
                  )}
                />
                <span className="text-sm">Probe parallel load</span>
              </button>
              <p className="text-muted-foreground text-xs">
                After the tasks finish, sends 1, then 2, then 4 identical requests at once and
                records how aggregate throughput holds up — the question a strictly serial run
                can never answer. Adds about seven extra requests per model.
              </p>
            </div>

            <Button
              onClick={start}
              disabled={starting || !suiteId || models.length === 0}
              className="gap-2 self-start"
            >
              {starting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              {starting ? "Starting…" : "Start benchmark"}
            </Button>
          </TabsPanel>

          <TabsPanel value="suites" className="space-y-4 pt-2">
            {editing !== null ? (
              <SuiteEditor
                key={editing}
                suite={editingSuite}
                onDone={() => setEditing(null)}
              />
            ) : (
              <>
                <ul className="space-y-2">
                  {suites.map((suite) => (
                    <li
                      key={suite.id}
                      className="bg-card/60 flex items-center gap-3 rounded-lg border px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-sm font-medium">
                          {suite.name}
                          {suite.builtin ? <Badge variant="secondary">built-in</Badge> : null}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {suite.tasks.length} tasks
                          {suite.description ? ` — ${suite.description}` : ""}
                        </p>
                      </div>
                      {!suite.builtin ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${suite.name}`}
                            onClick={() => setEditing(suite.id)}
                            disabled={isPending}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete ${suite.name}`}
                            onClick={() => removeSuite(suite.id)}
                            disabled={isPending}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing("new")}
                  className="gap-1.5"
                >
                  <Plus className="size-3.5" />
                  New custom suite
                </Button>
              </>
            )}
          </TabsPanel>

          <TabsPanel value="history" className="pt-2">
            <BenchmarkHistory entries={history} />
          </TabsPanel>

          <TabsPanel value="export" className="pt-2">
            <BenchmarkExport history={history} />
          </TabsPanel>
        </Tabs>
      </div>
    </div>
  );
}
