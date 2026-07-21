import { streamText } from "ai";

import { getThreadDetail, threadToPrompt } from "@/lib/gmail/client";
import { gmailErrorResponse } from "@/lib/gmail/http";
import { getGmailAccount } from "@/lib/gmail/store";
import { buildDraftSystem } from "@/lib/gmail/agent";
import { getChatModel } from "@/lib/provider";

export const maxDuration = 300;

interface DraftBody {
  threadId?: string;
  instruction?: string;
}

/** POST /api/gmail/draft — streams an AI-written reply body for the composer. */
export async function POST(request: Request) {
  const body: DraftBody = await request.json().catch(() => ({}));
  if (!body.threadId) {
    return Response.json({ error: "threadId is required" }, { status: 400 });
  }

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
    const detail = await getThreadDetail(body.threadId);
    const result = streamText({
      model,
      system: buildDraftSystem(getGmailAccount().email, body.instruction?.trim() ?? ""),
      prompt: `The thread so far:\n\n${threadToPrompt(detail)}\n\nWrite the reply body now.`,
    });
    return result.toTextStreamResponse();
  } catch (err) {
    return gmailErrorResponse(err);
  }
}
