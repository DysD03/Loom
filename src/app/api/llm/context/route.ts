import { parseModel } from "@/lib/models";
import { availableProviders, localEndpoint } from "@/lib/provider";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

interface LmStudioModel {
  id: string;
  state?: string;
  max_context_length?: number;
  loaded_context_length?: number;
}

interface ContextInfo {
  model: string | null;
  contextLength: number | null;
  loaded?: boolean;
}

const unknown = (model: string): ContextInfo => ({
  model: model || null,
  contextLength: null,
});

/**
 * LM Studio's native REST API (`/api/v0/models`) exposes context length; its base
 * is the OpenAI-compatible base URL with a trailing `/v1` dropped.
 */
async function lmStudioContext(
  baseUrl: string,
  apiKey: string,
  requested: string,
): Promise<ContextInfo> {
  const restBase = baseUrl.replace(/\/v1$/, "");
  const res = await fetch(`${restBase}/api/v0/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return unknown(requested);

  const data = (await res.json()) as { data?: LmStudioModel[] };
  const models = data.data ?? [];

  // Prefer the explicitly requested model; otherwise the first loaded one.
  const match =
    (requested ? models.find((m) => m.id === requested) : undefined) ??
    models.find((m) => m.state === "loaded") ??
    null;
  if (!match) return unknown(requested);

  return {
    model: match.id,
    contextLength: match.loaded_context_length ?? match.max_context_length ?? null,
    loaded: match.state === "loaded",
  };
}

/**
 * Ollama reports context length through its native `/api/show`, under an
 * architecture-scoped key (e.g. `llama.context_length`), so the first
 * `*.context_length` entry is the one to take.
 */
async function ollamaContext(baseUrl: string, requested: string): Promise<ContextInfo> {
  if (!requested) return unknown(requested);
  const restBase = baseUrl.replace(/\/v1$/, "");
  const res = await fetch(`${restBase}/api/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: requested }),
  });
  if (!res.ok) return unknown(requested);

  const data = (await res.json()) as { model_info?: Record<string, unknown> };
  const entry = Object.entries(data.model_info ?? {}).find(
    ([key, value]) => key.endsWith(".context_length") && typeof value === "number",
  );
  return {
    model: requested,
    contextLength: entry ? (entry[1] as number) : null,
    loaded: true,
  };
}

/**
 * Reports the context-window size (in tokens) of a local model, used by the chat
 * usage meter. The model string decides which endpoint is asked. Returns
 * `contextLength: null` whenever it can't be determined (a backend that exposes
 * neither API, an unreachable server) so the meter simply hides.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const settings = getSettings();
  const raw = searchParams.get("model")?.trim() || settings.llmModel.trim();
  const { provider, modelId } = parseModel(raw, availableProviders(settings));

  if (provider !== "local" && provider !== "ollama") {
    return Response.json(unknown(modelId));
  }

  const endpoint = localEndpoint(settings, provider);
  const baseUrl = endpoint.baseUrl.replace(/\/+$/, "");
  if (!baseUrl) return Response.json(unknown(modelId));

  try {
    const info =
      provider === "ollama"
        ? await ollamaContext(baseUrl, modelId)
        : await lmStudioContext(baseUrl, endpoint.apiKey, modelId);
    return Response.json(info);
  } catch {
    return Response.json(unknown(modelId));
  }
}
