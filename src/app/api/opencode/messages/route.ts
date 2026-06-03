import { getClient } from "@/lib/opencode";
import { getWorkspace } from "@/lib/workspaces";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const workspaceId = params.get("workspaceId");
  const sessionId = params.get("sessionId");
  const workspace = workspaceId ? getWorkspace(workspaceId) : undefined;
  if (!workspace || !sessionId) {
    return Response.json({ error: "workspaceId and sessionId are required" }, { status: 400 });
  }
  try {
    const client = await getClient(workspace.path);
    const result = await client.session.messages({ path: { id: sessionId } });
    return Response.json({ messages: result.data ?? [] });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
