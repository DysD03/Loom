import { ensureServer, getStatus, stop } from "@/lib/opencode";

export async function GET() {
  return Response.json(getStatus());
}

export async function POST() {
  try {
    await ensureServer();
  } catch (err) {
    return Response.json({
      running: false,
      baseUrl: null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return Response.json(getStatus());
}

export async function DELETE() {
  stop();
  return Response.json(getStatus());
}
