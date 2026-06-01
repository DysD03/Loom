import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { UIMessage } from "ai";

import { getSettings } from "./settings";

/**
 * Builds a chat model bound to the configured OpenAI-compatible endpoint.
 * Returns the resolved model id so callers can report which model ran.
 */
export function getChatModel(modelOverride?: string | null) {
  const settings = getSettings();
  const modelId = (modelOverride && modelOverride.trim()) || settings.llmModel.trim();

  const provider = createOpenAICompatible({
    name: "local",
    baseURL: settings.llmBaseUrl,
    apiKey: settings.llmApiKey || "lm-studio",
  });

  return { model: provider.chatModel(modelId), modelId };
}

/**
 * Builds an embedding model from settings. Returns null when no embeddings model
 * is configured, so callers can degrade gracefully (no semantic dedupe/retrieval).
 */
export function getEmbeddingModel() {
  const settings = getSettings();
  const modelId = settings.embeddingsModel.trim();
  if (!modelId) {
    return null;
  }

  const provider = createOpenAICompatible({
    name: "local",
    baseURL: settings.llmBaseUrl,
    apiKey: settings.llmApiKey || "lm-studio",
  });

  return { model: provider.embeddingModel(modelId), modelId };
}

/** Concatenates the text parts of a UI message into a plain string. */
export function textFromUIMessage(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}
