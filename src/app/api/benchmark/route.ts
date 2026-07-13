import { createRun, executeRun, getSuite, MAX_MODELS_PER_RUN } from "@/lib/benchmarks";

interface StartBody {
  suiteId?: string;
  models?: string[];
  title?: string;
}

/**
 * Starts a benchmark run and returns immediately; execution continues in the
 * server process (results stream into the DB, the page polls). A run can take
 * many minutes on slow local models, so nothing awaits it here.
 */
export async function POST(request: Request) {
  const body: StartBody = await request.json().catch(() => ({}));
  const suiteId = body.suiteId;
  const models = Array.isArray(body.models)
    ? [...new Set(body.models.map((m) => String(m).trim()).filter(Boolean))]
    : [];

  if (!suiteId) {
    return Response.json({ error: "suiteId is required" }, { status: 400 });
  }
  if (models.length === 0) {
    return Response.json({ error: "Select at least one model." }, { status: 400 });
  }
  if (models.length > MAX_MODELS_PER_RUN) {
    return Response.json(
      { error: `Compare at most ${MAX_MODELS_PER_RUN} models per run.` },
      { status: 400 },
    );
  }

  const suite = getSuite(suiteId);
  if (!suite) {
    return Response.json({ error: "Benchmark suite not found." }, { status: 404 });
  }

  const run = createRun({ suite, models, title: body.title });

  // Fire and forget — the executor owns run status from here.
  void executeRun(run.id).catch(() => {
    // executeRun records its own errors; this guard just keeps the rejection contained.
  });

  return Response.json({ runId: run.id });
}
