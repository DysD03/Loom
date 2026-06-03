import { getClient } from "@/lib/opencode";
import { getWorkspace } from "@/lib/workspaces";

export const maxDuration = 300;

interface PromptBody {
  workspaceId?: string;
  sessionId?: string;
  text?: string;
}

export async function POST(request: Request) {
  const body: PromptBody = await request.json().catch(() => ({}));
  const text = body.text?.trim();
  const workspace = body.workspaceId ? getWorkspace(body.workspaceId) : undefined;
  if (!workspace || !text) {
    return Response.json({ error: "workspaceId and text are required" }, { status: 400 });
  }

  try {
    const client = await getClient(workspace.path);

    let sessionId = body.sessionId;
    if (!sessionId) {
      const created = await client.session.create({ body: { title: text.slice(0, 50) } });
      if (!created.data) throw new Error("Could not create an opencode session.");
      sessionId = created.data.id;
    }

    // Blocking: opencode runs the agent (edits files, runs commands) until done.
    await client.session.prompt({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text }] },
    });

    return Response.json({ sessionId });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
