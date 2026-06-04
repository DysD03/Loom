import { convertToModelMessages, streamText, type UIMessage } from "ai";

import { getChatModel } from "@/lib/provider";
import { getEditorDocument } from "@/lib/editor";

export const maxDuration = 120;

const DOC_LIMIT = 8_000;

interface EditorChatBody {
  documentId?: string;
  messages?: UIMessage[];
}

export async function POST(request: Request) {
  const body: EditorChatBody = await request.json().catch(() => ({}));
  const { documentId, messages } = body;

  if (!messages?.length) {
    return Response.json({ error: "messages are required" }, { status: 400 });
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
    return Response.json({ error: "No model configured. Set a model in Settings." }, {
      status: 400,
    });
  }

  const doc = documentId ? getEditorDocument(documentId) : undefined;
  const content = doc?.content.trim() ? doc.content.slice(0, DOC_LIMIT) : "";

  const system =
    "You are Loom's writing assistant for a Markdown document the user is editing" +
    (doc ? ` titled "${doc.title}"` : "") +
    ". Help review, improve, and verify the document. When asked to verify use cases, " +
    "identify gaps, contradictions, missing or edge cases, ambiguous requirements, and " +
    "unstated assumptions, and list concrete, actionable findings. Answer in Markdown." +
    (content
      ? `\n\n--- CURRENT DOCUMENT ---\n${content}\n--- END DOCUMENT ---`
      : "\n\n(The document is currently empty.)");

  const result = streamText({
    model,
    system,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse({
    onError: (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      return `The local LLM request failed: ${detail}. Check that the server is running and a model is loaded (Settings → Test connection).`;
    },
  });
}
