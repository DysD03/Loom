import { streamText } from "ai";

import { getThreadDetail, listThreads, threadToPrompt } from "@/lib/gmail/client";
import { gmailErrorResponse } from "@/lib/gmail/http";
import { getCachedSummary, saveSummary } from "@/lib/gmail/store";
import { EMAIL_DIGEST_SYSTEM, EMAIL_SUMMARIZE_SYSTEM } from "@/lib/gmail/agent";
import { getChatModel } from "@/lib/provider";

export const maxDuration = 300;

const DIGEST_THREADS = 8;
const DIGEST_CHARS_PER_THREAD = 1200;

interface SummarizeBody {
  threadId?: string;
  digest?: boolean;
  /** Skip the cache and regenerate. */
  force?: boolean;
}

/**
 * POST /api/gmail/summarize
 * `{ threadId }` → summary of one thread (JSON when cached, else a text stream).
 * `{ digest: true }` → streamed briefing of the unread inbox.
 */
export async function POST(request: Request) {
  const body: SummarizeBody = await request.json().catch(() => ({}));

  let model: ReturnType<typeof getChatModel>["model"];
  let modelId: string;
  try {
    ({ model, modelId } = getChatModel());
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to build model." },
      { status: 400 },
    );
  }
  if (!modelId) {
    return Response.json(
      { error: "No model configured. Set a model in Settings." },
      { status: 400 },
    );
  }

  try {
    if (body.digest) {
      return digestResponse(model);
    }
    if (!body.threadId) {
      return Response.json({ error: "threadId or digest is required" }, { status: 400 });
    }
    return await threadSummaryResponse(model, modelId, body.threadId, body.force ?? false);
  } catch (err) {
    return gmailErrorResponse(err);
  }
}

async function threadSummaryResponse(
  model: ReturnType<typeof getChatModel>["model"],
  modelId: string,
  threadId: string,
  force: boolean,
): Promise<Response> {
  const detail = await getThreadDetail(threadId);
  const lastMessageId = detail.messages[detail.messages.length - 1]?.id ?? "";

  const cached =
    !force && lastMessageId ? getCachedSummary(threadId, lastMessageId) : undefined;
  if (cached) {
    return Response.json({ summary: cached.summary, cached: true });
  }

  const result = streamText({
    model,
    system: EMAIL_SUMMARIZE_SYSTEM,
    prompt: `Summarize this email thread:\n\n${threadToPrompt(detail)}`,
    onFinish: ({ text }) => {
      if (text.trim() && lastMessageId) {
        saveSummary(threadId, lastMessageId, text.trim(), modelId);
      }
    },
  });
  return result.toTextStreamResponse();
}

async function digestResponse(
  model: ReturnType<typeof getChatModel>["model"],
): Promise<Response> {
  const page = await listThreads({ view: "unread", maxResults: DIGEST_THREADS });
  if (page.threads.length === 0) {
    return Response.json({ summary: "Inbox zero — no unread email. 🎉", cached: false });
  }

  const details = await Promise.all(page.threads.map((t) => getThreadDetail(t.id)));
  const blocks = details.map((detail, i) => {
    const last = detail.messages[detail.messages.length - 1];
    const from = last ? `${last.from.name} <${last.from.email}>`.trim() : "unknown";
    const text = (last?.text || page.threads[i].snippet || "").slice(
      0,
      DIGEST_CHARS_PER_THREAD,
    );
    return `### ${detail.subject}\nFrom: ${from}\nThread id: ${detail.id}\n\n${text}`;
  });

  const result = streamText({
    model,
    system: EMAIL_DIGEST_SYSTEM,
    prompt: `Unread email (newest first):\n\n${blocks.join("\n\n---\n\n")}`,
  });
  return result.toTextStreamResponse();
}
