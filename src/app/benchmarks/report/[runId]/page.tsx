import { notFound } from "next/navigation";

import { BenchmarkReport } from "@/components/benchmarks/report";
import { ReportToolbar } from "@/components/benchmarks/report-toolbar";
import { getRun, listResults, summarizeRun } from "@/lib/benchmarks";
import { getSettings } from "@/lib/settings";
import { parseSections } from "@/lib/report";
import { parseTokenPricing } from "@/lib/benchmark-cost";

export const dynamic = "force-dynamic";

/**
 * The printable view of one run. It lives on its own route so the export tab can
 * preview it in an iframe and print that document directly — the print then
 * contains only the report, with none of the app shell around it.
 */
export default async function BenchmarkReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ sections?: string; bare?: string }>;
}) {
  const { runId } = await params;
  const { sections: sectionsParam, bare } = await searchParams;

  const run = getRun(runId);
  if (!run) notFound();

  const results = listResults(run.id);
  const settings = getSettings();
  const settingsRate = settings.computeCostPerHour;
  const costPerHour = run.costPerHour ?? (settingsRate > 0 ? settingsRate : null);

  return (
    <div className="report-paper min-h-full overflow-y-auto py-8">
      {bare === "1" ? null : <ReportToolbar />}
      <BenchmarkReport
        run={{
          id: run.id,
          title: run.title,
          suiteName: run.suiteName,
          status: run.status,
          createdAt: run.createdAt,
          temperature: run.temperature,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
        }}
        summary={summarizeRun(run, results)}
        sections={parseSections(sectionsParam)}
        costPerHour={costPerHour}
        pricing={parseTokenPricing(settings.tokenPricing)}
        generatedAt={new Date().toISOString()}
      />
    </div>
  );
}
