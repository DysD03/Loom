import "server-only";

import { GmailApiError } from "./client";
import { GmailAuthError } from "./oauth";

/**
 * Maps Gmail errors onto JSON responses the client can act on:
 * auth problems carry a `code` so the UI can flip to the connect/reconnect card.
 */
export function gmailErrorResponse(err: unknown): Response {
  if (err instanceof GmailAuthError) {
    return Response.json({ error: err.message, code: err.code }, { status: 401 });
  }
  if (err instanceof GmailApiError) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 502;
    return Response.json({ error: err.message }, { status });
  }
  const message = err instanceof Error ? err.message : "Unexpected Gmail error.";
  return Response.json({ error: message }, { status: 500 });
}
