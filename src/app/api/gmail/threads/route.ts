import type { NextRequest } from "next/server";

import { listThreads } from "@/lib/gmail/client";
import { gmailErrorResponse } from "@/lib/gmail/http";
import { EMAIL_VIEWS, type EmailViewKey } from "@/lib/gmail/types";

/** GET /api/gmail/threads?view=inbox&q=…&pageToken=… — a page of thread summaries. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const viewParam = params.get("view") ?? "inbox";
  const view = EMAIL_VIEWS.some((v) => v.key === viewParam)
    ? (viewParam as EmailViewKey)
    : "inbox";

  try {
    const page = await listThreads({
      view,
      q: params.get("q") ?? undefined,
      pageToken: params.get("pageToken") ?? undefined,
    });
    return Response.json(page);
  } catch (err) {
    return gmailErrorResponse(err);
  }
}
