import type { NextRequest } from "next/server";

import { getAttachment } from "@/lib/gmail/client";
import { gmailErrorResponse } from "@/lib/gmail/http";

/** GET /api/gmail/attachment?messageId=…&attachmentId=…&filename=… — downloads one attachment. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const messageId = params.get("messageId");
  const attachmentId = params.get("attachmentId");
  if (!messageId || !attachmentId) {
    return Response.json(
      { error: "messageId and attachmentId are required" },
      { status: 400 },
    );
  }

  // Strip characters that could break the Content-Disposition header.
  const filename = (params.get("filename") ?? "attachment").replace(/[\r\n"\\;]/g, "_");
  const mimeType = params.get("mimeType") ?? "application/octet-stream";
  // Images embedded in a body (`cid:` refs) are requested with inline=1 so the
  // browser renders them instead of offering a download.
  const disposition = params.get("inline") === "1" ? "inline" : "attachment";

  try {
    const bytes = await getAttachment(messageId, attachmentId);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": /^[\w.+-]+\/[\w.+-]+$/.test(mimeType)
          ? mimeType
          : "application/octet-stream",
        "Content-Disposition": `${disposition}; filename="${filename}"`,
        // Attachment bytes are immutable; avoid refetching on every re-render.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return gmailErrorResponse(err);
  }
}
