import {
  configuredCloudProviders,
  localEndpoints,
  type LocalEndpoint,
} from "@/lib/provider";
import { ollamaModelId } from "@/lib/models";
import { getSettings } from "@/lib/settings";

interface ModelsResponse {
  data?: Array<{ id?: string }>;
}

export interface EndpointModels {
  provider: LocalEndpoint["provider"];
  label: string;
  /** Stored model ids — already prefixed for the secondary endpoint. */
  models: string[];
  /** Why this endpoint returned nothing, when it failed. */
  error?: string;
}

/** Lists the model ids one OpenAI-compatible server exposes via `GET /models`. */
async function listModels(endpoint: LocalEndpoint): Promise<EndpointModels> {
  const baseUrl = endpoint.baseUrl.replace(/\/+$/, "");
  const stored = (id: string) =>
    endpoint.provider === "ollama" ? ollamaModelId(id) : id;

  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${endpoint.apiKey}` },
    });
    if (!res.ok) {
      return {
        provider: endpoint.provider,
        label: endpoint.label,
        models: [],
        error: `HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as ModelsResponse;
    const models = (data.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .sort((a, b) => a.localeCompare(b))
      .map(stored);
    return { provider: endpoint.provider, label: endpoint.label, models };
  } catch (err) {
    return {
      provider: endpoint.provider,
      label: endpoint.label,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Lists the models available across every configured local endpoint, and reports
 * which cloud providers have an API key, so the model pickers can offer their
 * curated models too.
 *
 * `models` is the flat combined list every picker renders; `endpoints` carries
 * the same ids grouped by server, for callers that want to label the source.
 * Endpoints are queried in parallel — a server that is down must not delay one
 * that is up.
 */
export async function GET() {
  const settings = getSettings();
  const cloudProviders = configuredCloudProviders(settings);
  const endpoints = await Promise.all(localEndpoints(settings).map(listModels));

  const models = endpoints.flatMap((e) => e.models);
  // Only surface an error when nothing at all came back, so one dead secondary
  // endpoint doesn't mask a perfectly good primary.
  const failure = models.length === 0 ? endpoints.find((e) => e.error)?.error : undefined;

  return Response.json({ models, endpoints, cloudProviders, error: failure });
}
