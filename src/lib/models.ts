/**
 * Model identity + the curated cloud catalog.
 *
 * A model is addressed by a single string that may carry a provider prefix:
 *   "anthropic/claude-..."  "openai/gpt-4o"  "google/gemini-2.5-pro"
 * A string with no recognized prefix is a **local** (OpenAI-compatible) model —
 * this keeps every pre-existing conversation.model value working untouched.
 *
 * Shared by the server provider layer and the client model picker, so this file
 * must stay free of `server-only` and of any DB/SDK imports.
 */

export const CLOUD_PROVIDERS = ["anthropic", "openai", "google"] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

/** "local" is the configured OpenAI-compatible endpoint (LM Studio / Ollama / …). */
export type ProviderKind = CloudProvider | "local";

export interface ParsedModel {
  provider: ProviderKind;
  /** The bare model id with any provider prefix stripped. */
  modelId: string;
}

const PREFIXES: Record<CloudProvider, string> = {
  anthropic: "anthropic/",
  openai: "openai/",
  google: "google/",
};

/** Splits a stored model string into its provider and bare id. */
export function parseModel(value: string): ParsedModel {
  const trimmed = value.trim();
  for (const provider of CLOUD_PROVIDERS) {
    const prefix = PREFIXES[provider];
    if (trimmed.startsWith(prefix)) {
      return { provider, modelId: trimmed.slice(prefix.length) };
    }
  }
  return { provider: "local", modelId: trimmed };
}

/** Builds the stored model string for a cloud model. */
export function cloudModelId(provider: CloudProvider, modelId: string): string {
  return `${PREFIXES[provider]}${modelId}`;
}

export interface CatalogEntry {
  /** Full stored value, e.g. "anthropic/claude-opus-4-1". */
  id: string;
  /** Human label for the picker. */
  label: string;
}

export interface ProviderCatalog {
  provider: CloudProvider;
  label: string;
  models: CatalogEntry[];
}

const entry = (provider: CloudProvider, modelId: string, label: string): CatalogEntry => ({
  id: cloudModelId(provider, modelId),
  label,
});

/**
 * Curated list of current cloud models shown in the picker. Users can still type
 * any other id (free-text custom entry) — this is just the convenient default set.
 */
export const CLOUD_CATALOG: ProviderCatalog[] = [
  {
    provider: "anthropic",
    label: "Anthropic",
    models: [
      entry("anthropic", "claude-opus-4-1", "Claude Opus 4.1"),
      entry("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5"),
      entry("anthropic", "claude-haiku-4-5", "Claude Haiku 4.5"),
    ],
  },
  {
    provider: "openai",
    label: "OpenAI",
    models: [
      entry("openai", "gpt-4o", "GPT-4o"),
      entry("openai", "gpt-4o-mini", "GPT-4o mini"),
      entry("openai", "o4-mini", "o4-mini"),
    ],
  },
  {
    provider: "google",
    label: "Google",
    models: [
      entry("google", "gemini-2.5-pro", "Gemini 2.5 Pro"),
      entry("google", "gemini-2.5-flash", "Gemini 2.5 Flash"),
    ],
  },
];

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  local: "Local",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
};
