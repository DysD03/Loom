import { sendReply } from "@/lib/gmail/client";
import { gmailErrorResponse } from "@/lib/gmail/http";
import { formatAddress } from "@/lib/gmail/types";

interface SendBody {
  threadId?: string;
  body?: string;
  replyAll?: boolean;
}

/** POST /api/gmail/send — sends a reply on a thread as the connected account. */
export async function POST(request: Request) {
  const body: SendBody = await request.json().catch(() => ({}));
  if (!body.threadId || !body.body?.trim()) {
    return Response.json({ error: "threadId and body are required" }, { status: 400 });
  }

  try {
    const result = await sendReply({
      threadId: body.threadId,
      body: body.body,
      replyAll: body.replyAll ?? false,
    });
    return Response.json({
      ok: true,
      id: result.id,
      to: result.to.map(formatAddress).join(", "),
      subject: result.subject,
    });
  } catch (err) {
    return gmailErrorResponse(err);
  }
}
