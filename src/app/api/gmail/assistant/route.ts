import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";

import {
  buildEmailAssistantSystem,
  buildEmailToolRegistry,
  EMAIL_ASSISTANT_MAX_STEPS,
} from "@/lib/gmail/agent";
import { getGmailAccount } from "@/lib/gmail/store";
import { checkToolSupport } from "@/lib/capabilities";
import { getChatModel } from "@/lib/provider";

export const maxDuration = 300;

interface AssistantBody {
  messages?: UIMessage[];
  contextThreadId?: string;
}

/**
 * POST /api/gmail/assistant — the plan-then-execute email agent. Tools run
 * server-side; `sendReply` pauses for the user's approval (AI SDK tool
 * approvals) and executes on the resumed request.
 */
export async function POST(request: Request) {
  const body: AssistantBody = await request.json().catch(() => ({}));
  const { messages, contextThreadId } = body;

  if (!messages?.length) {
    return Response.json({ error: "messages are required" }, { status: 400 });
  }

  const account = getGmailAccount();
  if (!account.refreshToken) {
    return Response.json(
      { error: "Gmail is not connected.", code: "not_connected" },
      { status: 401 },
    );
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

  // Degrade to plain chat when the model can't call tools (never fail silently).
  const support = await checkToolSupport().catch(() => null);
  const toolsAvailable = !support || support.supported;

  const result = streamText({
    model,
    system: buildEmailAssistantSystem({
      selfEmail: account.email,
      contextThreadId: contextThreadId || undefined,
      toolsAvailable,
    }),
    messages: await convertToModelMessages(messages),
    tools: toolsAvailable ? buildEmailToolRegistry() : undefined,
    stopWhen: stepCountIs(EMAIL_ASSISTANT_MAX_STEPS),
  });

  return result.toUIMessageStreamResponse({
    onError: (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      return (
        `The email assistant run failed: ${detail}. ` +
        "Check that the local LLM server is running and a tool-capable model is loaded."
      );
    },
  });
}
