import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai";

import { getChatModel, textFromUIMessage } from "@/lib/provider";
import { addMessage, getAgentConfig, getConversation } from "@/lib/conversations";
import { getPersona } from "@/lib/personas";
import {
  embedText,
  formatMemoriesForPrompt,
  hasMemories,
  retrieveRelevantMemories,
} from "@/lib/memory";
import {
  formatChunksForPrompt,
  hasReadyDocuments,
  retrieveRelevantChunks,
} from "@/lib/documents";
import { buildRetrievalInfo } from "@/lib/transparency";
import { RETRIEVAL_PART_TYPE } from "@/lib/retrieval";
import { buildToolRegistry, stepCountIs } from "@/lib/tools";
import { checkToolSupport } from "@/lib/capabilities";
import {
  AGENT_MAX_STEPS,
  AGENT_STEP_LIMIT,
  AGENT_SYSTEM_PROMPT,
  DIALOGUE_MAX_ROUNDS,
  buildCriticSystem,
  buildSolverSystem,
  buildSynthesisSystem,
  buildTurnPrompt,
} from "@/lib/agent";

export const maxDuration = 300;

interface AgentBody {
  conversationId?: string;
  messages?: UIMessage[];
}

/** True when a UI message has any content worth persisting (text, tool calls, reasoning). */
function hasPersistableContent(message: UIMessage): boolean {
  return message.parts.some(
    (p) =>
      p.type !== "step-start" &&
      p.type !== RETRIEVAL_PART_TYPE &&
      (p.type !== "text" || p.text.trim().length > 0),
  );
}

function persistAssistant(conversationId: string, message: UIMessage): void {
  if (message.role !== "assistant" || !hasPersistableContent(message)) {
    return;
  }
  addMessage({
    conversationId,
    role: "assistant",
    content: textFromUIMessage(message),
    parts: message.parts,
  });
}

const STREAM_FAIL =
  "Check that the local LLM server is running and a tool-capable model is loaded (Settings → Test connection).";

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

  const config = getAgentConfig(conversationId);
  const maxSteps = Math.min(
    AGENT_STEP_LIMIT,
    Math.max(1, config.maxSteps ?? AGENT_MAX_STEPS),
  );
  const queryText = lastMessage?.role === "user" ? textFromUIMessage(lastMessage) : "";

  // Persona drives the assistant's identity; the operational tool-loop guidance is appended.
  const persona = config.personaId ? getPersona(config.personaId) : undefined;
  let baseSystem = persona?.systemPrompt.trim()
    ? `${persona.systemPrompt.trim()}\n\n${AGENT_SYSTEM_PROMPT}`
    : AGENT_SYSTEM_PROMPT;

  // Everything before streaming is best-effort and latency-critical: probe tool
  // support and build the registry while the query is embedded once (shared by
  // memory + document retrieval), then run both retrievals concurrently. Skip
  // the embedding call entirely when there is nothing to retrieve against —
  // otherwise it forces LM Studio to JIT-load the embedding model before every
  // chat completion.
  const supportPromise = checkToolSupport(conversation.model).catch(() => null);
  // config.tools null => all tools; [] => explicitly none.
  const toolsPromise = buildToolRegistry(config.tools ?? undefined).catch(() => undefined);
  const wantsRetrieval = Boolean(queryText) && (hasMemories() || hasReadyDocuments());
  const queryEmbedding = wantsRetrieval ? await embedText(queryText).catch(() => null) : null;
  const [memoriesUsed, chunksUsed] = await Promise.all([
    retrieveRelevantMemories(queryText, undefined, queryEmbedding).catch(() => []),
    retrieveRelevantChunks(queryText, undefined, queryEmbedding).catch(() => []),
  ]);

  const memoryBlock = formatMemoriesForPrompt(memoriesUsed);
  if (memoryBlock) {
    baseSystem = `${baseSystem}\n\n${memoryBlock}`;
  }
  const docBlock = formatChunksForPrompt(chunksUsed);
  if (docBlock) {
    baseSystem = `${baseSystem}\n\n${docBlock}`;
  }
  const retrieval = buildRetrievalInfo(memoriesUsed, chunksUsed);

  // Only wire tools when the model can actually use them; otherwise degrade to
  // plain chat so a tool-incapable model doesn't error the whole stream.
  let tools: Awaited<ReturnType<typeof buildToolRegistry>> | undefined;
  const support = await supportPromise;
  if (!support || support.supported) {
    tools = await toolsPromise;
  } else {
    baseSystem = `${baseSystem}\n\nNote: tool calling is unavailable for the current model, so answer directly without tools.`;
  }

  const modelMessages = await convertToModelMessages(messages);

  // --- Plain agent run (no self-dialogue): stream straight through. ---
  if (!config.selfDialogue.enabled || !queryText) {
    const stream = createUIMessageStream<UIMessage>({
      originalMessages: messages,
      onFinish: ({ responseMessage }) => persistAssistant(conversationId, responseMessage),
      onError: (error) => {
        const detail = error instanceof Error ? error.message : String(error);
        return `The agent run failed: ${detail}. ${STREAM_FAIL}`;
      },
      execute: ({ writer }) => {
        if (retrieval) {
          writer.write({ type: RETRIEVAL_PART_TYPE, data: retrieval });
        }
        const result = streamText({
          model,
          system: baseSystem,
          messages: modelMessages,
          tools,
          stopWhen: stepCountIs(maxSteps),
        });
        writer.merge(result.toUIMessageStream({ sendStart: !retrieval }));
      },
    });

    return createUIMessageStreamResponse({ stream });
  }

  // --- Self-dialogue run: Solver↔Critic debate streamed as reasoning, then synthesize. ---
  const rounds = Math.min(DIALOGUE_MAX_ROUNDS, Math.max(1, config.selfDialogue.rounds));
  const solverPersona = config.selfDialogue.solverPersonaId
    ? getPersona(config.selfDialogue.solverPersonaId)
    : undefined;
  const criticPersona = config.selfDialogue.criticPersonaId
    ? getPersona(config.selfDialogue.criticPersonaId)
    : undefined;
  const solverSystem = buildSolverSystem(solverPersona?.systemPrompt);
  const criticSystem = buildCriticSystem(criticPersona?.systemPrompt);

  const stream = createUIMessageStream<UIMessage>({
    originalMessages: messages,
    onFinish: ({ responseMessage }) => persistAssistant(conversationId, responseMessage),
    onError: (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      return `The agent run failed: ${detail}. ${STREAM_FAIL}`;
    },
    execute: async ({ writer }) => {
      if (retrieval) {
        writer.write({ type: RETRIEVAL_PART_TYPE, data: retrieval });
      }
      let transcript = "";

      // Streams one debate turn into its own collapsible reasoning block and returns its text.
      const runTurn = async (
        role: "Solver" | "Critic",
        roundNo: number,
        system: string,
        label: string,
      ): Promise<string> => {
        const id = `${role.toLowerCase()}-${roundNo}`;
        writer.write({ type: "reasoning-start", id });
        writer.write({ type: "reasoning-delta", id, delta: `${label}\n` });
        const turn = streamText({
          model,
          system,
          prompt: buildTurnPrompt(role, queryText, transcript),
        });
        let acc = "";
        for await (const delta of turn.textStream) {
          acc += delta;
          writer.write({ type: "reasoning-delta", id, delta });
        }
        writer.write({ type: "reasoning-end", id });
        return acc.trim();
      };

      for (let r = 1; r <= rounds; r++) {
        const solver = await runTurn("Solver", r, solverSystem, `▸ Solver · round ${r}`);
        transcript += `\n\nSOLVER (round ${r}):\n${solver}`;
        const critic = await runTurn("Critic", r, criticSystem, `▸ Critic · round ${r}`);
        transcript += `\n\nCRITIC (round ${r}):\n${critic}`;
      }

      // Final answer, informed by the deliberation, with tools available.
      const result = streamText({
        model,
        system: buildSynthesisSystem(baseSystem, transcript),
        messages: modelMessages,
        tools,
        stopWhen: stepCountIs(maxSteps),
      });
      writer.merge(
        result.toUIMessageStream({ sendStart: false, sendFinish: false }),
      );
    },
  });

  return createUIMessageStreamResponse({ stream });
}
