import { convertToModelMessages, streamText, type UIMessage } from "ai";

import { getChatModel, textFromUIMessage } from "@/lib/provider";
import { addMessage, getAgentConfig, getConversation } from "@/lib/conversations";
import { formatMemoriesForPrompt, retrieveRelevantMemories } from "@/lib/memory";
import { buildToolRegistry, stepCountIs } from "@/lib/tools";
import { checkToolSupport } from "@/lib/capabilities";
import { AGENT_MAX_STEPS, AGENT_STEP_LIMIT, AGENT_SYSTEM_PROMPT } from "@/lib/agent";

export const maxDuration = 300;

interface AgentBody {
  conversationId?: string;
  messages?: UIMessage[];
}

/** True when a UI message has any content worth persisting (text, tool calls, reasoning). */
function hasPersistableContent(message: UIMessage): boolean {
  return message.parts.some(
    (p) => p.type !== "step-start" && (p.type !== "text" || p.text.trim().length > 0),
  );
}

export async function POST(request: Request) {
  const body: AgentBody = await request.json().catch(() => ({}));
  const { conversationId, messages } = body;

  if (!conversationId || !messages?.length) {
    return Response.json(
      { error: "conversationId and messages are required" },
      { status: 400 },
    );
  }

  const conversation = getConversation(conversationId);
  if (!conversation) {
    return Response.json({ error: "conversation not found" }, { status: 404 });
  }

  const { model, modelId } = getChatModel(conversation.model);
  if (!modelId) {
    return Response.json(
      { error: "No model configured. Set a model in Settings." },
      { status: 400 },
    );
  }

  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.role === "user") {
    const text = textFromUIMessage(lastMessage);
    if (text) {
      addMessage({ conversationId, role: "user", content: text });
    }
  }

  const config = getAgentConfig(conversationId);
  const maxSteps = Math.min(
    AGENT_STEP_LIMIT,
    Math.max(1, config.maxSteps ?? AGENT_MAX_STEPS),
  );

  const queryText = lastMessage?.role === "user" ? textFromUIMessage(lastMessage) : "";
  let system = AGENT_SYSTEM_PROMPT;
  try {
    const relevant = await retrieveRelevantMemories(queryText);
    const memoryBlock = formatMemoriesForPrompt(relevant);
    if (memoryBlock) {
      system = `${AGENT_SYSTEM_PROMPT}\n\n${memoryBlock}`;
    }
  } catch {
    // Memory retrieval is best-effort; never block the agent on it.
  }

  // Only wire tools when the model can actually use them; otherwise degrade to
  // plain chat so a tool-incapable model doesn't error the whole stream.
  let tools: Awaited<ReturnType<typeof buildToolRegistry>> | undefined;
  try {
    const support = await checkToolSupport();
    if (support.supported) {
      // config.tools null => all tools; [] => explicitly none.
      tools = await buildToolRegistry(config.tools ?? undefined);
    } else {
      system = `${system}\n\nNote: tool calling is unavailable for the current model, so answer directly without tools.`;
    }
  } catch {
    // Tools are best-effort; don't block the agent if the registry fails.
  }

  const result = streamText({
    model,
    system,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(maxSteps),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: ({ responseMessage }) => {
      if (responseMessage.role !== "assistant" || !hasPersistableContent(responseMessage)) {
        return;
      }
      addMessage({
        conversationId,
        role: "assistant",
        content: textFromUIMessage(responseMessage),
        parts: responseMessage.parts,
      });
    },
    onError: (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      return `The agent run failed: ${detail}. Check that the local LLM server is running and a tool-capable model is loaded (Settings → Test connection).`;
    },
  });
}
