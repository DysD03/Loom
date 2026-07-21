import type { NextRequest } from "next/server";

import { getThreadDetail } from "@/lib/gmail/client";
import { gmailErrorResponse } from "@/lib/gmail/http";
import { getCachedSummary } from "@/lib/gmail/store";

/** GET /api/gmail/thread?id=… — full thread detail (+ cached summary if fresh). */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const detail = await getThreadDetail(id);
    const lastMessageId = detail.messages[detail.messages.length - 1]?.id ?? "";
    const cached = lastMessageId ? getCachedSummary(id, lastMessageId) : undefined;
    return Response.json({ ...detail, cachedSummary: cached?.summary ?? null });
  } catch (err) {
    return gmailErrorResponse(err);
  }
}
