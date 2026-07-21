import { NextResponse, type NextRequest } from "next/server";

import { completeOAuth } from "@/lib/gmail/oauth";

/** Google redirects here after consent; exchanges the code and stores tokens. */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const params = request.nextUrl.searchParams;
  const target = new URL("/email", origin);

  const oauthError = params.get("error");
  if (oauthError) {
    target.searchParams.set(
      "error",
      oauthError === "access_denied"
        ? "Google consent was cancelled."
        : `Google returned an error: ${oauthError}`,
    );
    return NextResponse.redirect(target);
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    target.searchParams.set("error", "Missing authorization code — try connecting again.");
    return NextResponse.redirect(target);
  }

  try {
    await completeOAuth(origin, code, state);
    target.searchParams.set("connected", "1");
  } catch (err) {
    target.searchParams.set(
      "error",
      err instanceof Error ? err.message : "Connecting Gmail failed.",
    );
  }
  return NextResponse.redirect(target);
}
