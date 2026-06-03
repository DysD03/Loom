import { getClient } from "@/lib/opencode";
import { getWorkspace } from "@/lib/workspaces";

function upstreamError(err: unknown) {
  return Response.json(
    { error: err instanceof Error ? err.message : String(err) },
    { status: 502 },
  );
}

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  const workspace = workspaceId ? getWorkspace(workspaceId) : undefined;
  if (!workspace) {
    return Response.json({ error: "workspace not found" }, { status: 404 });
  }
  try {
    const client = await getClient(workspace.path);
    const result = await client.session.list();
    return Response.json({ sessions: result.data ?? [] });
  } catch (err) {
    return upstreamError(err);
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    workspaceId?: string;
    title?: string;
  };
  const workspace = body.workspaceId ? getWorkspace(body.workspaceId) : undefined;
  if (!workspace) {
    return Response.json({ error: "workspace not found" }, { status: 404 });
  }
  try {
    const client = await getClient(workspace.path);
    const result = await client.session.create({
      body: body.title ? { title: body.title } : {},
    });
    return Response.json({ session: result.data });
  } catch (err) {
    return upstreamError(err);
  }
}
