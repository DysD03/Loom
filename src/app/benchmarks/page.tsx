import { BenchmarkCreate } from "@/components/benchmarks/benchmark-create";
import { RunList } from "@/components/benchmarks/run-list";
import { RunView, type RunCostInfo } from "@/components/benchmarks/run-view";
import {
  ensureBuiltinSuites,
  getRun,
  historyView,
  listResults,
  listRuns,
  listSuites,
  loadTasks,
  summarizeRun,
} from "@/lib/benchmarks";
import { getSettings } from "@/lib/settings";
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

  // Effective $/hour for the open run: its snapshot, else today's setting.
  let cost: RunCostInfo | null = null;
  if (active) {
    const settingsRate = getSettings().computeCostPerHour;
    if (active.costPerHour !== null) {
      cost = { perHour: active.costPerHour, source: "snapshot" };
    } else if (settingsRate > 0) {
      cost = { perHour: settingsRate, source: "settings" };
    }
  }

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
            startedAt: active.startedAt,
            finishedAt: active.finishedAt,
          }}
          summary={summarizeRun(active, listResults(active.id))}
          cost={cost}
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
          history={historyView()}
        />
      )}
    </div>
  );
}
