import { BenchmarkCreate } from "@/components/benchmarks/benchmark-create";
import { RunList } from "@/components/benchmarks/run-list";
import { RunView } from "@/components/benchmarks/run-view";
import {
  ensureBuiltinSuites,
  getRun,
  listResults,
  listRuns,
  listSuites,
  loadTasks,
  summarizeRun,
} from "@/lib/benchmarks";
import type { BenchTask } from "@/lib/benchmark-score";

export const dynamic = "force-dynamic";

export default async function BenchmarksPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string }>;
}) {
  const { r } = await searchParams;
  ensureBuiltinSuites();
  const runs = listRuns();
  const active = r ? getRun(r) : undefined;

  return (
    <div className="flex h-full">
      <RunList
        runs={runs.map((run) => ({ id: run.id, title: run.title, status: run.status }))}
        activeId={active?.id}
      />
      {active ? (
        <RunView
          key={`${active.id}:${active.status}`}
          run={{
            id: active.id,
            title: active.title,
            suiteName: active.suiteName,
            status: active.status,
            error: active.error,
          }}
          summary={summarizeRun(active, listResults(active.id))}
        />
      ) : (
        <BenchmarkCreate
          suites={listSuites().map((suite) => ({
            id: suite.id,
            name: suite.name,
            description: suite.description,
            builtin: suite.builtin,
            tasks: loadTasks(suite) as BenchTask[],
          }))}
        />
      )}
    </div>
  );
}
