import {
  getRun,
  listResults,
  loadModels,
  loadTasks,
  loadTemperatures,
  MAX_OUTPUT_TOKENS,
} from "@/lib/benchmarks";
import {
  exportFilename,
  parseFormat,
  toCsv,
  toJson,
  type ExportInput,
} from "@/lib/benchmark-export";

export const dynamic = "force-dynamic";

/**
 * Every sample of a run as CSV or JSON. The app's own views are opinionated;
 * this is the escape hatch — the raw rows, so a run can be re-analysed in a
 * spreadsheet or a notebook without going through the UI's questions.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const run = getRun(runId);
  if (!run) {
    return Response.json({ error: "Benchmark run not found." }, { status: 404 });
  }

  const format = parseFormat(new URL(request.url).searchParams.get("format"));
  const input: ExportInput = {
    run: {
      id: run.id,
      title: run.title,
      suiteName: run.suiteName,
      status: run.status,
      temperature: run.temperature,
      temperatures: loadTemperatures(run),
      repeats: run.repeats,
      models: loadModels(run),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      createdAt: run.createdAt,
    },
    tasks: loadTasks(run),
    rows: listResults(run.id),
    outputCap: MAX_OUTPUT_TOKENS,
  };

  const body = format === "json" ? toJson(input) : toCsv(input);
  return new Response(body, {
    headers: {
      "Content-Type":
        format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(input.run, format)}"`,
      "Cache-Control": "no-store",
    },
  });
}
