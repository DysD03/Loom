import "server-only";

import { getAccessToken } from "./oauth";
import { getGmailAccount } from "./store";
import {
  buildRawEmail,
  decodeSnippet,
  headerValue,
  parseAddressList,
  parseMessage,
  replyHeaders,
  replyRecipients,
  replySubject,
  type GmailMessageRaw,
} from "./parse";
import type {
  EmailAddress,
  EmailViewKey,
  ThreadDetail,
  ThreadSummary,
} from "./types";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

async function gmailFetch(
  path: string,
  init: RequestInit = {},
  retried = false,
): Promise<Response> {
  const token = await getAccessToken(retried);
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  // A stale access token gets one forced refresh + retry.
  if (res.status === 401 && !retried) {
    return gmailFetch(path, init, true);
  }
  return res;
}

async function gmailJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await gmailFetch(path, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = `Gmail API returned ${res.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      // keep the generic message
    }
    throw new GmailApiError(message, res.status);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Thread listing
// ---------------------------------------------------------------------------

const VIEW_LABELS: Record<EmailViewKey, string[]> = {
  inbox: ["INBOX"],
  unread: ["INBOX", "UNREAD"],
  sent: ["SENT"],
  all: [],
};

export interface ListThreadsOptions {
  view?: EmailViewKey;
  /** Gmail search query (`from:…`, `is:unread`, `newer_than:7d`, …). */
  q?: string;
  pageToken?: string;
  maxResults?: number;
}

export interface ThreadPage {
  threads: ThreadSummary[];
  nextPageToken: string | null;
}

interface ThreadListResponse {
  threads?: Array<{ id: string }>;
  nextPageToken?: string;
}

interface ThreadMetaResponse {
  id: string;
  messages?: GmailMessageRaw[];
}

function summarizeThreadMeta(meta: ThreadMetaResponse): ThreadSummary {
  const messages = meta.messages ?? [];
  const first = messages[0];
  const last = messages[messages.length - 1];
  const from = parseAddressList(headerValue(last?.payload, "From"))[0] ?? {
    name: "",
    email: "",
  };
  return {
    id: meta.id,
    subject: headerValue(first?.payload, "Subject") || "(no subject)",
    from,
    date: Number(last?.internalDate ?? 0) || 0,
    snippet: decodeSnippet(last?.snippet ?? ""),
    unread: messages.some((m) => (m.labelIds ?? []).includes("UNREAD")),
    messageCount: messages.length,
    lastMessageId: last?.id ?? "",
  };
}

/** Lists threads for a view/query, resolving each to a display summary. */
export async function listThreads(options: ListThreadsOptions = {}): Promise<ThreadPage> {
  const params = new URLSearchParams();
  params.set("maxResults", String(Math.min(50, Math.max(1, options.maxResults ?? 25))));
  if (options.pageToken) params.set("pageToken", options.pageToken);
  if (options.q?.trim()) params.set("q", options.q.trim());
  for (const label of VIEW_LABELS[options.view ?? "inbox"]) {
    params.append("labelIds", label);
  }

  const list = await gmailJson<ThreadListResponse>(`/threads?${params.toString()}`);
  const ids = (list.threads ?? []).map((t) => t.id);

  const metaParams =
    "format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date";
  const metas = await Promise.all(
    ids.map((id) => gmailJson<ThreadMetaResponse>(`/threads/${id}?${metaParams}`)),
  );

  return {
    threads: metas.map(summarizeThreadMeta),
    nextPageToken: list.nextPageToken ?? null,
  };
}

// ---------------------------------------------------------------------------
// Thread detail
// ---------------------------------------------------------------------------

interface ThreadFullResponse {
  id: string;
  messages?: GmailMessageRaw[];
}

export async function getThreadDetail(threadId: string): Promise<ThreadDetail> {
  const data = await gmailJson<ThreadFullResponse>(
    `/threads/${encodeURIComponent(threadId)}?format=full`,
  );
  const messages = (data.messages ?? []).map(parseMessage);
  return {
    id: data.id,
    subject: messages[0]?.subject || "(no subject)",
    messages,
  };
}

// ---------------------------------------------------------------------------
// Sending replies
// ---------------------------------------------------------------------------

export interface SendReplyInput {
  threadId: string;
  body: string;
  replyAll?: boolean;
}

export interface SendReplyResult {
  id: string;
  threadId: string;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
}

/**
 * Replies to a thread as the connected account: picks the newest message from
 * someone else (falling back to the newest overall), threads the reply via
 * In-Reply-To/References, and sends it on the same Gmail thread.
 */
export async function sendReply(input: SendReplyInput): Promise<SendReplyResult> {
  const body = input.body.trim();
  if (!body) {
    throw new GmailApiError("Reply body is empty.", 400);
  }

  const self = getGmailAccount().email;
  const detail = await getThreadDetail(input.threadId);
  if (detail.messages.length === 0) {
    throw new GmailApiError("Thread has no messages.", 404);
  }

  const fromOthers = [...detail.messages]
    .reverse()
    .find((m) => m.from.email.toLowerCase() !== self.toLowerCase());
  const target = fromOthers ?? detail.messages[detail.messages.length - 1];

  const { to, cc } = replyRecipients(target, self, input.replyAll ?? false);
  if (to.length === 0) {
    throw new GmailApiError("Could not determine a recipient for this reply.", 400);
  }

  const subject = replySubject(detail.subject);
  const raw = buildRawEmail({
    from: self,
    to,
    cc: cc.length ? cc : undefined,
    subject,
    text: body,
    ...replyHeaders(target),
  });

  const sent = await gmailJson<{ id: string; threadId: string }>(`/messages/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw, threadId: input.threadId }),
  });

  return { id: sent.id, threadId: sent.threadId, to, cc, subject };
}

// ---------------------------------------------------------------------------
// Thread modification (archive / read state)
// ---------------------------------------------------------------------------

export type ThreadAction = "archive" | "unarchive" | "read" | "unread";

const ACTION_LABELS: Record<ThreadAction, { add: string[]; remove: string[] }> = {
  archive: { add: [], remove: ["INBOX"] },
  unarchive: { add: ["INBOX"], remove: [] },
  read: { add: [], remove: ["UNREAD"] },
  unread: { add: ["UNREAD"], remove: [] },
};

export async function modifyThread(threadId: string, action: ThreadAction): Promise<void> {
  const { add, remove } = ACTION_LABELS[action];
  await gmailJson(`/threads/${encodeURIComponent(threadId)}/modify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
  });
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export async function getAttachment(
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const data = await gmailJson<{ data?: string }>(
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
  return Buffer.from(data.data ?? "", "base64url");
}

// ---------------------------------------------------------------------------
// LLM prompt formatting
// ---------------------------------------------------------------------------

function clip(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function formatDate(ms: number): string {
  return ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "unknown date";
}

/** Renders a thread as plain text for summarize/draft/tool prompts. */
export function threadToPrompt(detail: ThreadDetail, maxChars = 10_000): string {
  const perMessage = Math.max(600, Math.floor(maxChars / Math.max(1, detail.messages.length)));
  const blocks = detail.messages.map((m) => {
    const to = m.to.map((a) => a.email).join(", ");
    // Embedded logos/signature images aren't attachments the reader cares about.
    const files = m.attachments.filter((a) => !a.inline);
    return [
      `From: ${m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email}`,
      `To: ${to || "(none)"}`,
      `Date: ${formatDate(m.date)}`,
      files.length ? `Attachments: ${files.map((a) => a.filename).join(", ")}` : "",
      "",
      clip(m.text || m.snippet || "(empty message)", perMessage),
    ]
      .filter((line, i) => line !== "" || i === 4)
      .join("\n");
  });
  return clip(`Subject: ${detail.subject}\n\n${blocks.join("\n\n---\n\n")}`, maxChars);
}
