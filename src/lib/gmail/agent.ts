import "server-only";

import { tool, type ToolSet } from "ai";
import { z } from "zod";

import {
  getThreadDetail,
  listThreads,
  modifyThread,
  sendReply,
  threadToPrompt,
} from "./client";
import { formatAddress, type ThreadSummary } from "./types";

export const EMAIL_ASSISTANT_MAX_STEPS = 10;

export const EMAIL_SUMMARIZE_SYSTEM =
  "You summarize email threads. Be concise and factual. Cover: what the thread is about, " +
  "who wants what, decisions made, open questions, action items with owners and deadlines. " +
  "Use short bullet points. Never invent details that are not in the thread.";

export const EMAIL_DIGEST_SYSTEM =
  "You write a briefing of the user's unread email. Group by importance: start with " +
  "**Needs a reply**, then **Worth reading**, then **Low priority / bulk**. For each email give " +
  "one line: sender — what it is — the ask or deadline if any. Be terse; no preamble, no sign-off. " +
  "Never invent emails that are not in the input.";

export function buildDraftSystem(selfEmail: string, instruction: string): string {
  return [
    `You draft an email reply on behalf of ${selfEmail}.`,
    "Output ONLY the reply body as plain text — no subject line, no quoted original, " +
      "no placeholders like [Name]; if a sign-off name is needed, use the sender's " +
      "address mailbox name or omit the sign-off.",
    "Match the thread's tone and language. Be clear and brief.",
    instruction ? `Follow this guidance from the user: ${instruction}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildEmailAssistantSystem(options: {
  selfEmail: string;
  contextThreadId?: string;
  toolsAvailable: boolean;
}): string {
  const { selfEmail, contextThreadId, toolsAvailable } = options;
  const today = new Date().toDateString();

  const base = [
    "You are Loom's email assistant, operating on the user's Gmail account " +
      `(${selfEmail}) through tools. Today is ${today}.`,
    contextThreadId
      ? `The user is currently viewing thread ${contextThreadId} — when they say ` +
        `"this email"/"this thread", readThread that id.`
      : "",
  ];

  if (!toolsAvailable) {
    return [
      ...base,
      "Tool calling is unavailable for the current model, so you cannot read or act on " +
        "the mailbox right now. Say so plainly and answer from the conversation only.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    ...base,
    [
      "How to work:",
      "- For anything beyond a single lookup, first state a brief numbered plan " +
        "(one line per step), then execute it with tools immediately, narrating progress.",
      "- Find email with searchEmails using Gmail query syntax (from:, subject:, " +
        "is:unread, newer_than:7d, has:attachment, …). Read a thread with readThread " +
        "before summarizing it or replying to it.",
      "- To reply, call sendReply with the complete, ready-to-send body. The user " +
        "approves or denies every send — never claim an email was sent unless the tool " +
        "returned sent: true, and never call sendReply with placeholder text.",
      "- Archiving and read/unread changes are reversible; do them without asking when " +
        "they serve the user's request.",
      "- Ground every statement in tool results. If a search finds nothing, say so.",
      "- Keep answers compact. Use bullets for multi-email summaries.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function errorPayload(err: unknown): { error: string } {
  return { error: err instanceof Error ? err.message : String(err) };
}

function toolThreadSummary(t: ThreadSummary) {
  return {
    threadId: t.id,
    subject: t.subject,
    from: formatAddress(t.from),
    date: t.date ? new Date(t.date).toISOString() : "",
    snippet: t.snippet,
    unread: t.unread,
    messageCount: t.messageCount,
  };
}

/** Gmail tools for the email assistant. `sendReply` is gated on user approval. */
export function buildEmailToolRegistry(): ToolSet {
  const searchInput = z.object({
    query: z
      .string()
      .describe(
        "Gmail search query, e.g. \"is:unread newer_than:7d\" or \"from:alice subject:invoice\". " +
          "Empty string lists the inbox.",
      ),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(10)
      .describe("Number of threads to return (1–20, default 10)"),
  });

  const readInput = z.object({
    threadId: z.string().describe("The thread id from searchEmails"),
  });

  const sendInput = z.object({
    threadId: z.string().describe("The thread id to reply on"),
    body: z
      .string()
      .describe("The complete plain-text reply body, ready to send — no placeholders"),
    replyAll: z
      .boolean()
      .optional()
      .default(false)
      .describe("Reply to everyone on the message instead of only the sender"),
  });

  const archiveInput = z.object({
    threadId: z.string().describe("The thread id to archive (removes it from the inbox)"),
  });

  const markReadInput = z.object({
    threadId: z.string().describe("The thread id to update"),
    read: z.boolean().describe("true marks the thread read, false marks it unread"),
  });

  return {
    searchEmails: tool({
      description:
        "Search the user's Gmail threads. Returns thread summaries (id, subject, sender, " +
        "date, snippet, unread). Supports full Gmail query syntax.",
      inputSchema: searchInput,
      execute: async ({ query, maxResults }: z.infer<typeof searchInput>) => {
        try {
          const page = await listThreads({
            view: query.trim() ? "all" : "inbox",
            q: query,
            maxResults,
          });
          return { results: page.threads.map(toolThreadSummary) };
        } catch (err) {
          return errorPayload(err);
        }
      },
    }),

    readThread: tool({
      description:
        "Read a full email thread by id: every message with sender, recipients, date, and " +
        "body text. Use before summarizing or replying.",
      inputSchema: readInput,
      execute: async ({ threadId }: z.infer<typeof readInput>) => {
        try {
          const detail = await getThreadDetail(threadId);
          return { threadId: detail.id, content: threadToPrompt(detail, 8_000) };
        } catch (err) {
          return errorPayload(err);
        }
      },
    }),

    sendReply: tool({
      description:
        "Send a reply on an email thread as the user. The user must approve the exact body " +
        "before it is sent. Put the final, complete reply text in `body`.",
      inputSchema: sendInput,
      needsApproval: true,
      execute: async ({ threadId, body, replyAll }: z.infer<typeof sendInput>) => {
        try {
          const result = await sendReply({ threadId, body, replyAll });
          return {
            sent: true,
            to: result.to.map(formatAddress).join(", "),
            subject: result.subject,
          };
        } catch (err) {
          return { sent: false, ...errorPayload(err) };
        }
      },
    }),

    archiveThread: tool({
      description: "Archive a thread (remove it from the inbox). Reversible in Gmail.",
      inputSchema: archiveInput,
      execute: async ({ threadId }: z.infer<typeof archiveInput>) => {
        try {
          await modifyThread(threadId, "archive");
          return { archived: true, threadId };
        } catch (err) {
          return errorPayload(err);
        }
      },
    }),

    markThreadRead: tool({
      description: "Mark a thread read or unread.",
      inputSchema: markReadInput,
      execute: async ({ threadId, read }: z.infer<typeof markReadInput>) => {
        try {
          await modifyThread(threadId, read ? "read" : "unread");
          return { threadId, read };
        } catch (err) {
          return errorPayload(err);
        }
      },
    }),
  };
}
