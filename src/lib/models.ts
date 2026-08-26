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

/**
 * The two local OpenAI-compatible endpoints. `local` is the primary one (LM
 * Studio by default) and owns every unprefixed id, so ids stored before a
 * second endpoint existed keep resolving exactly as they did; `ollama` is the
 * optional second server, addressed by an explicit `ollama/` prefix.
 */
export const LOCAL_PROVIDERS = ["local", "ollama"] as const;
export type LocalProvider = (typeof LOCAL_PROVIDERS)[number];

export type ProviderKind = CloudProvider | LocalProvider;

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

const OLLAMA_PREFIX = "ollama/";

/** Which optional providers are actually configured, for prefix resolution. */
export interface AvailableProviders {
  clouds?: readonly CloudProvider[];
  /** True once a second local endpoint has a base URL. */
  ollama?: boolean;
}

/**
 * Splits a stored model string into its provider and bare id.
 *
 * Local model ids can legitimately carry a publisher prefix that collides with
 * our cloud prefixes (LM Studio's "google/gemma-3-12b"), so a prefix routes to
 * the cloud only when that provider is in `configuredClouds` (it has an API key)
 * or the id is one of our curated cloud models — otherwise the whole string is
 * treated as a local id.
 */
export function parseModel(
  value: string,
  available: AvailableProviders = {},
): ParsedModel {
  const trimmed = value.trim();
  const configuredClouds = available.clouds ?? CLOUD_PROVIDERS;

  // Same collision rule as the cloud prefixes: only claim "ollama/…" when that
  // endpoint exists, so the string stays a plain local id otherwise.
  if (available.ollama && trimmed.startsWith(OLLAMA_PREFIX)) {
    return { provider: "ollama", modelId: trimmed.slice(OLLAMA_PREFIX.length) };
  }

  for (const provider of CLOUD_PROVIDERS) {
    const prefix = PREFIXES[provider];
    if (!trimmed.startsWith(prefix)) {
      continue;
    }
    if (configuredClouds.includes(provider) || isCuratedCloudId(trimmed)) {
      return { provider, modelId: trimmed.slice(prefix.length) };
    }
    break;
  }
  return { provider: "local", modelId: trimmed };
}

/** Builds the stored model string for a cloud model. */
export function cloudModelId(provider: CloudProvider, modelId: string): string {
  return `${PREFIXES[provider]}${modelId}`;
}

/** Builds the stored model string for a model served by the second local endpoint. */
export function ollamaModelId(modelId: string): string {
  return `${OLLAMA_PREFIX}${modelId}`;
}

export function isOllamaModelId(value: string): boolean {
  return value.trim().startsWith(OLLAMA_PREFIX);
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

const CURATED_IDS = new Set(CLOUD_CATALOG.flatMap((group) => group.models.map((m) => m.id)));

/** True when the id is one of the curated cloud picks — always cloud, even keyless,
 * so the user gets a clear "add an API key" error instead of a local 404. */
function isCuratedCloudId(id: string): boolean {
  return CURATED_IDS.has(id);
}

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  local: "LM Studio",
  ollama: "Ollama",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
};
