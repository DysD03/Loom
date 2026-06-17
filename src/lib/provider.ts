import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { EmbeddingModel, LanguageModel, UIMessage } from "ai";

import { CLOUD_PROVIDERS, type CloudProvider, parseModel } from "./models";
import { getSettings } from "./settings";
import type { AppSettings } from "@/db/schema";

/** Builds the local OpenAI-compatible provider (LM Studio / Ollama / …) from settings. */
function localProvider(settings: AppSettings) {
  return createOpenAICompatible({
    name: "local",
    baseURL: settings.llmBaseUrl,
    apiKey: settings.llmApiKey || "lm-studio",
  });
}

function rawCloudKey(settings: AppSettings, provider: CloudProvider): string {
  const key =
    provider === "anthropic"
      ? settings.anthropicApiKey
      : provider === "openai"
        ? settings.openaiApiKey
        : settings.googleApiKey;
  return key.trim();
}

/** Cloud providers that have an API key configured (and so can be routed to). */
export function configuredCloudProviders(settings: AppSettings): CloudProvider[] {
  return CLOUD_PROVIDERS.filter((provider) => rawCloudKey(settings, provider) !== "");
}

/** Reads the API key for a cloud provider; throws a clear error when it is missing. */
function cloudApiKey(settings: AppSettings, provider: CloudProvider): string {
  const key = rawCloudKey(settings, provider);
  if (!key) {
    throw new Error(
      `No API key configured for ${provider}. Add one in Settings → Cloud providers.`,
    );
  }
  return key;
}

/** Builds a cloud chat model for the given provider + bare model id. */
function cloudChatModel(
  settings: AppSettings,
  provider: CloudProvider,
  modelId: string,
): LanguageModel {
  const apiKey = cloudApiKey(settings, provider);
  if (provider === "anthropic") {
    return createAnthropic({ apiKey })(modelId);
  }
  if (provider === "openai") {
    return createOpenAI({ apiKey })(modelId);
  }
  return createGoogleGenerativeAI({ apiKey })(modelId);
}

/**
 * Builds a chat model from a model string that may be prefixed with a cloud
 * provider ("anthropic/…", "openai/…", "google/…"); an unprefixed id resolves to
 * the configured local OpenAI-compatible endpoint. Returns the resolved model id
 * so callers can report which model ran.
 */
export function getChatModel(modelOverride?: string | null) {
  const settings = getSettings();
  const raw = (modelOverride && modelOverride.trim()) || settings.llmModel.trim();
  const { provider, modelId } = parseModel(raw, configuredCloudProviders(settings));

  if (provider === "local") {
    return { model: localProvider(settings).chatModel(modelId), modelId };
  }

  return { model: cloudChatModel(settings, provider, modelId), modelId };
}

/**
 * Builds the model for background tasks (titles, memory extraction, canvas
 * seeding, suggestions). Uses the Settings utility model when set — typically a
 * small fast model — otherwise falls back like `getChatModel` (the caller's
 * override, then the global chat model).
 */
export function getUtilityModel(fallbackOverride?: string | null) {
  const settings = getSettings();
  const utility = settings.utilityModel.trim();
  return getChatModel(utility || fallbackOverride);
}

/**
 * Builds an embedding model. Embeddings always run on the configured local
 * endpoint (cloud embeddings are out of scope). Returns null when no embeddings
 * model is configured, so callers can degrade gracefully.
 */
export function getEmbeddingModel(): { model: EmbeddingModel; modelId: string } | null {
  const settings = getSettings();
  const modelId = settings.embeddingsModel.trim();
  if (!modelId) {
    return null;
  }

  return { model: localProvider(settings).embeddingModel(modelId), modelId };
}

/** Concatenates the text parts of a UI message into a plain string. */
export function textFromUIMessage(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}
