import { getChatModel } from "@/lib/provider";
import { getConversation, renameConversation } from "@/lib/conversations";
import { runBidirectional, type GoalEvent } from "@/lib/bidirectional";

export const maxDuration = 300;

interface Body {
  conversationId?: string;
  problemSpec?: string;
  startState?: string;
  goalState?: string;
  maxRounds?: number;
}

/** Streams the bidirectional goal-convergence run as newline-delimited JSON events. */
export async function POST(request: Request) {
  const body: Body = await request.json().catch(() => ({}));
  const conversationId = body.conversationId;
  const problemSpec = body.problemSpec?.trim() ?? "";
  const startState = body.startState?.trim() ?? "";
  const goalState = body.goalState?.trim() ?? "";

  if (!conversationId || !startState || !goalState) {
    return Response.json(
      { error: "conversationId, startState and goalState are required" },
      { status: 400 },
    );
  }

  const conversation = getConversation(conversationId);
  if (!conversation) {
    return Response.json({ error: "conversation not found" }, { status: 404 });
  }

  let model: ReturnType<typeof getChatModel>["model"];
  let modelId: string;
  try {
    ({ model, modelId } = getChatModel(conversation.model));
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

  // Name the conversation after its goal.
  if (conversation.title === "New chat") {
    renameConversation(conversationId, goalState);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: GoalEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of runBidirectional({
          conversationId,
          problemSpec,
          startState,
          goalState,
          model,
          maxRounds: body.maxRounds,
        })) {
          send(event);
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
