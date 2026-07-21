import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, ne } from "drizzle-orm";

import { db } from "@/db/client";
import {
  emailSummaries,
  gmailAccount,
  type EmailSummary,
  type GmailAccount,
} from "@/db/schema";

const ROW_ID = 1;

/** Returns the single Gmail account row, creating it with defaults on first access. */
export function getGmailAccount(): GmailAccount {
  const existing = db
    .select()
    .from(gmailAccount)
    .where(eq(gmailAccount.id, ROW_ID))
    .get();

  if (existing) {
    return existing;
  }

  return db.insert(gmailAccount).values({ id: ROW_ID }).returning().get();
}

export function updateGmailAccount(
  patch: Partial<Omit<GmailAccount, "id" | "updatedAt">>,
): GmailAccount {
  getGmailAccount();
  return db
    .update(gmailAccount)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(gmailAccount.id, ROW_ID))
    .returning()
    .get();
}

/** Drops tokens + identity but keeps the OAuth client so reconnecting is one click. */
export function disconnectGmail(): void {
  updateGmailAccount({
    email: "",
    refreshToken: "",
    accessToken: "",
    accessTokenExpiresAt: 0,
    scope: "",
    oauthState: null,
    connectedAt: null,
  });
}

// ---------------------------------------------------------------------------
// Thread summary cache
// ---------------------------------------------------------------------------

/** Returns the cached summary for a thread if it still matches its newest message. */
export function getCachedSummary(
  threadId: string,
  lastMessageId: string,
): EmailSummary | undefined {
  return db
    .select()
    .from(emailSummaries)
    .where(
      and(
        eq(emailSummaries.threadId, threadId),
        eq(emailSummaries.lastMessageId, lastMessageId),
      ),
    )
    .get();
}

export function saveSummary(
  threadId: string,
  lastMessageId: string,
  summary: string,
  model: string,
): void {
  // One live summary per thread: drop stale rows for older messages.
  db.delete(emailSummaries)
    .where(
      and(
        eq(emailSummaries.threadId, threadId),
        ne(emailSummaries.lastMessageId, lastMessageId),
      ),
    )
    .run();
  const existing = getCachedSummary(threadId, lastMessageId);
  if (existing) {
    db.update(emailSummaries)
      .set({ summary, model })
      .where(eq(emailSummaries.id, existing.id))
      .run();
    return;
  }
  db.insert(emailSummaries)
    .values({ id: randomUUID(), threadId, lastMessageId, summary, model })
    .run();
}
