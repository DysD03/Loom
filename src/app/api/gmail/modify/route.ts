import { modifyThread, type ThreadAction } from "@/lib/gmail/client";
import { gmailErrorResponse } from "@/lib/gmail/http";

const ACTIONS: ThreadAction[] = ["archive", "unarchive", "read", "unread"];

interface ModifyBody {
  threadId?: string;
  action?: string;
}

/** POST /api/gmail/modify — archive/unarchive or flip read state of a thread. */
export async function POST(request: Request) {
  const body: ModifyBody = await request.json().catch(() => ({}));
  const action = ACTIONS.find((a) => a === body.action);
  if (!body.threadId || !action) {
    return Response.json(
      { error: `threadId and one of ${ACTIONS.join("/")} are required` },
      { status: 400 },
    );
  }

  try {
    await modifyThread(body.threadId, action);
    return Response.json({ ok: true });
  } catch (err) {
    return gmailErrorResponse(err);
  }
}
