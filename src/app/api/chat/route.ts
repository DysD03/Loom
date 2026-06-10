import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai";

import { getChatModel, textFromUIMessage } from "@/lib/provider";
import { addMessage, getConversation } from "@/lib/conversations";
import { embedText, formatMemoriesForPrompt, retrieveRelevantMemories } from "@/lib/memory";
import { formatChunksForPrompt, retrieveRelevantChunks } from "@/lib/documents";
import { buildRetrievalInfo } from "@/lib/transparency";
import { RETRIEVAL_PART_TYPE } from "@/lib/retrieval";
import { buildToolRegistry, stepCountIs } from "@/lib/tools";

export const maxDuration = 120;

const SYSTEM_PROMPT =
  "You are Loom, a helpful assistant running locally on the user's machine. " +
  "Answer clearly and concisely. Use Markdown for formatting and fenced code blocks for code.";

interface ChatBody {
  conversationId?: string;
  messages?: UIMessage[];
}

export async function POST(request: Request) {
  const body: ChatBody = await request.json().catch(() => ({}));
  const { conversationId, messages } = body;

  if (!conversationId || !messages?.length) {
    return Response.json({ error: "conversationId and messages are required" }, { status: 400 });
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

  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.role === "user") {
    const text = textFromUIMessage(lastMessage);
    const hasFiles = lastMessage.parts.some((p) => p.type === "file");
    if (text || hasFiles) {
      addMessage({
        conversationId,
        role: "user",
        content: text,
        // Persist parts only when attachments exist so plain text stays lean.
        parts: hasFiles ? lastMessage.parts : undefined,
      });
    }
  }

  const queryText = lastMessage?.role === "user" ? textFromUIMessage(lastMessage) : "";

  // Everything before streaming is best-effort and latency-critical: build the
  // tool registry while the query is embedded once (shared by memory + document
  // retrieval), then run both retrievals concurrently.
  const toolsPromise = buildToolRegistry().catch(() => undefined);
  const queryEmbedding = queryText ? await embedText(queryText).catch(() => null) : null;
  const [memoriesUsed, chunksUsed] = await Promise.all([
    retrieveRelevantMemories(queryText, undefined, queryEmbedding).catch(() => []),
    retrieveRelevantChunks(queryText, undefined, queryEmbedding).catch(() => []),
  ]);

  let system = SYSTEM_PROMPT;
  const memoryBlock = formatMemoriesForPrompt(memoriesUsed);
  if (memoryBlock) {
    system = `${system}\n\n${memoryBlock}`;
  }
  const docBlock = formatChunksForPrompt(chunksUsed);
  if (docBlock) {
    system = `${system}\n\n${docBlock}`;
  }

  const retrieval = buildRetrievalInfo(memoriesUsed, chunksUsed);
  const tools = await toolsPromise;
  const modelMessages = await convertToModelMessages(messages);

  const stream = createUIMessageStream<UIMessage>({
    originalMessages: messages,
    onFinish: ({ responseMessage }) => {
      if (responseMessage.role !== "assistant") {
        return;
      }
      const text = textFromUIMessage(responseMessage);
      const hasTools = responseMessage.parts.some(
        (p) => p.type !== "step-start" && p.type !== "text" && p.type !== RETRIEVAL_PART_TYPE,
      );
      if (text.trim() || hasTools) {
        addMessage({
          conversationId,
          role: "assistant",
          content: text,
          parts: responseMessage.parts,
        });
      }
    },
    onError: (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      return `The local LLM request failed: ${detail}. Check that the server is running and a tool-capable model is loaded (Settings → Test connection).`;
    },
    execute: ({ writer }) => {
      // Surface what was injected into the system prompt as a collapsible
      // "Context used" block; the part persists with the message for replay.
      if (retrieval) {
        writer.write({ type: RETRIEVAL_PART_TYPE, data: retrieval });
      }
      const result = streamText({
        model,
        system,
        messages: modelMessages,
        tools,
        stopWhen: stepCountIs(5),
      });
      writer.merge(result.toUIMessageStream({ sendStart: !retrieval }));
    },
  });

  return createUIMessageStreamResponse({ stream });
}
