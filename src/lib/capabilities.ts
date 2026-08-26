import "server-only";

import { parseModel } from "./models";
import { availableProviders, localEndpoint } from "./provider";
import { getSettings } from "./settings";

export interface ToolSupport {
  /** Whether the model accepted a tool-enabled request. Defaults true when unknown. */
  supported: boolean;
  /** True when we actually reached the server and got a definitive answer. */
  checked: boolean;
  /** Human-readable reason when tools are unsupported (or unconfigured). */
  reason?: string;
}

interface CacheEntry {
  key: string;
  result: ToolSupport;
  expires: number;
}

const TTL_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 8000;

// Cache survives hot-reload so we don't re-probe the model on every request.
const g = globalThis as typeof globalThis & { __toolSupportCache?: CacheEntry };

/**
 * Probes the configured OpenAI-compatible endpoint with a tool-enabled request to
 * determine whether the model can do tool calling.
 *
 * - `supported: true, checked: true`  → server accepted a tools array.
 * - `supported: false, checked: true` → server rejected it (no tool support).
 * - `supported: true, checked: false` → couldn't reach the server; assume capable
 *   so we don't show a false warning (real connection errors surface in chat).
 *
 * `modelOverride` is the conversation's model (which may be a cloud model). Cloud
 * providers all support tool calling, so we skip the probe entirely for them.
 */
export async function checkToolSupport(
  modelOverride?: string | null,
  force = false,
): Promise<ToolSupport> {
  const settings = getSettings();
  const raw = (modelOverride && modelOverride.trim()) || settings.llmModel.trim();
  const { provider, modelId: model } = parseModel(raw, availableProviders(settings));

  if (!model) {
    return {
      supported: false,
      checked: true,
      reason: "No model is configured. Set one in Settings to use tools.",
    };
  }

  // Cloud providers (Anthropic / OpenAI / Google) all support tool calling.
  if (provider !== "local" && provider !== "ollama") {
    return { supported: true, checked: true };
  }

  // Probe the endpoint that actually serves this model, not just the primary one.
  const endpoint = localEndpoint(settings, provider);
  const baseUrl = endpoint.baseUrl.replace(/\/+$/, "");
  const key = `${baseUrl}|${model}`;

  const cached = g.__toolSupportCache;
  if (!force && cached && cached.key === key && cached.expires > Date.now()) {
    return cached.result;
  }

  const result = await probe(baseUrl, endpoint.apiKey, model);
  g.__toolSupportCache = { key, result, expires: Date.now() + TTL_MS };
  return result;
}

async function probe(baseUrl: string, apiKey: string, model: string): Promise<ToolSupport> {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey || "lm-studio"}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        temperature: 0,
        stream: false,
        tools: [
          {
            type: "function",
            function: {
              name: "loom_probe",
              description: "Capability probe — never call this.",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    if (res.ok) {
      return { supported: true, checked: true };
    }

    const body = await res.text().catch(() => "");
    return {
      supported: false,
      checked: true,
      reason:
        `Model "${model}" rejected a tool-enabled request (HTTP ${res.status}). ` +
        "Tool calls are disabled — this conversation will run as plain chat. " +
        "Load a tool-capable model in Settings to enable Agents." +
        (body ? ` Server said: ${body.slice(0, 200)}` : ""),
    };
  } catch {
    // Connection/timeout — unknown, not a capability failure. Don't warn.
    return { supported: true, checked: false };
  }
}
