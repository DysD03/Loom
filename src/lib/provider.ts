import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { EmbeddingModel, LanguageModel, UIMessage } from "ai";

import {
  CLOUD_PROVIDERS,
  parseModel,
  type AvailableProviders,
  type CloudProvider,
  type LocalProvider,
} from "./models";
import { getSettings } from "./settings";
import type { AppSettings } from "@/db/schema";

/**
 * Per-call model options. `fetch` lets a caller wrap the HTTP request — the
 * benchmark executor uses it to timestamp dispatch and first response byte, so
 * it can split time-to-first-token into encode / queue / prefill.
 */
export interface ModelOptions {
  fetch?: typeof globalThis.fetch;
}

/** Connection details for one of the local OpenAI-compatible endpoints. */
export interface LocalEndpoint {
  provider: LocalProvider;
  label: string;
  baseUrl: string;
  apiKey: string;
}

/** True once the second local endpoint has a base URL configured. */
export function ollamaConfigured(settings: AppSettings): boolean {
  return settings.ollamaBaseUrl.trim() !== "";
}

/** Resolves one local endpoint's connection details from settings. */
export function localEndpoint(
  settings: AppSettings,
  provider: LocalProvider = "local",
): LocalEndpoint {
  if (provider === "ollama") {
    return {
      provider,
      label: "Ollama",
      baseUrl: settings.ollamaBaseUrl.trim(),
      apiKey: settings.ollamaApiKey.trim() || "ollama",
    };
  }
  return {
    provider,
    label: "LM Studio",
    baseUrl: settings.llmBaseUrl.trim(),
    apiKey: settings.llmApiKey.trim() || "lm-studio",
  };
}

/** Every local endpoint that is actually configured, primary first. */
export function localEndpoints(settings: AppSettings): LocalEndpoint[] {
  const endpoints = [localEndpoint(settings, "local")];
  if (ollamaConfigured(settings)) endpoints.push(localEndpoint(settings, "ollama"));
  return endpoints.filter((e) => e.baseUrl !== "");
}

/** What `parseModel` needs to resolve prefixes against this install's config. */
export function availableProviders(settings: AppSettings): AvailableProviders {
  return {
    clouds: configuredCloudProviders(settings),
    ollama: ollamaConfigured(settings),
  };
}

/** Builds an OpenAI-compatible provider for one of the local endpoints. */
function localProvider(
  settings: AppSettings,
  provider: LocalProvider = "local",
  options?: ModelOptions,
) {
  const endpoint = localEndpoint(settings, provider);
  return createOpenAICompatible({
    name: endpoint.provider,
    baseURL: endpoint.baseUrl,
    apiKey: endpoint.apiKey,
    fetch: options?.fetch,
    // Sends `stream_options: { include_usage: true }`. Without it an
    // OpenAI-compatible server streams no usage object at all, and every
    // token-derived number — decode and prefill tokens/sec, time per output
    // token, the token counts behind the cost estimate — comes out null while
    // the timing charts still look fine.
    includeUsage: true,
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
  options?: ModelOptions,
): LanguageModel {
  const config = { apiKey: cloudApiKey(settings, provider), fetch: options?.fetch };
  if (provider === "anthropic") {
    return createAnthropic(config)(modelId);
  }
  if (provider === "openai") {
    return createOpenAI(config)(modelId);
  }
  return createGoogleGenerativeAI(config)(modelId);
}

/**
 * Builds a chat model from a model string that may be prefixed with a cloud
 * provider ("anthropic/…", "openai/…", "google/…"); an unprefixed id resolves to
 * the configured local OpenAI-compatible endpoint. Returns the resolved model id
 * so callers can report which model ran.
 */
export function getChatModel(modelOverride?: string | null, options?: ModelOptions) {
  const settings = getSettings();
  const raw = (modelOverride && modelOverride.trim()) || settings.llmModel.trim();
  const { provider, modelId } = parseModel(raw, availableProviders(settings));

  if (provider === "local" || provider === "ollama") {
    return {
      model: localProvider(settings, provider, options).chatModel(modelId),
      modelId,
    };
  }

  return { model: cloudChatModel(settings, provider, modelId, options), modelId };
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
  const raw = settings.embeddingsModel.trim();
  if (!raw) {
    return null;
  }

  // An `ollama/`-prefixed id embeds on the second endpoint; anything else on the
  // primary one. Cloud embeddings stay out of scope.
  const { provider, modelId } = parseModel(raw, availableProviders(settings));
  const local: LocalProvider = provider === "ollama" ? "ollama" : "local";
  return { model: localProvider(settings, local).embeddingModel(modelId), modelId };
}

/** Concatenates the text parts of a UI message into a plain string. */
export function textFromUIMessage(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}
