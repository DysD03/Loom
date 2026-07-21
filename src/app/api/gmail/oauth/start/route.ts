import { NextResponse, type NextRequest } from "next/server";

import { beginOAuth } from "@/lib/gmail/oauth";

/** Kicks off the Google consent flow and redirects the browser to it. */
export function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  try {
    return NextResponse.redirect(beginOAuth(origin));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not start the connect flow.";
    const url = new URL("/email", origin);
    url.searchParams.set("error", message);
    return NextResponse.redirect(url);
  }
}
