"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gauge, Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import type { BenchTask } from "@/lib/benchmark-score";
import { deleteSuiteAction } from "@/app/benchmarks/actions";
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

export function BenchmarkCreate({ suites }: { suites: SuiteView[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [suiteId, setSuiteId] = useState<string>(suites[0]?.id ?? "");
  const [models, setModels] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [starting, setStarting] = useState(false);
  /** null = list, "new" = creating, otherwise the suite id being edited. */
  const [editing, setEditing] = useState<string | null>(null);

  const selectedSuite = suites.find((s) => s.id === suiteId);
  const editingSuite = suites.find((s) => s.id === editing && !s.builtin);

  async function start() {
    if (!suiteId || models.length === 0) return;
    setStarting(true);
    try {
      const res = await fetch("/api/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suiteId, models, title: title.trim() || undefined }),
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
                  <SelectValue placeholder="Pick a suite" />
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
        </Tabs>
      </div>
    </div>
  );
}
