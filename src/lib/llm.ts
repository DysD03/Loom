import "server-only";

export type PingResult =
  | { ok: true; model: string; reply: string }
  | { ok: false; error: string };

interface ChatCompletionChoice {
  message?: { content?: string | null };
}

interface ChatCompletionResponse {
  model?: string;
  choices?: ChatCompletionChoice[];
}

/** Asks an OpenAI-compatible server for the first model it exposes. */
async function firstModel(baseUrl: string, apiKey: string): Promise<string> {
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey || "lm-studio"}` },
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    return data.data?.find((entry) => typeof entry.id === "string" && entry.id)?.id ?? "";
  } catch {
    return "";
  }
}

/**
 * Sends a minimal chat completion to an OpenAI-compatible endpoint to confirm it
 * is reachable and serving a model.
 *
 * When no model is given, the server is asked which ones it has and the first is
 * used — testing a second endpoint should not require first choosing a model
 * from it, and Ollama rejects a completion with no model name.
 */
export async function pingLlm(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): Promise<PingResult> {
  const baseUrl = params.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;
  const model = params.model || (await firstModel(baseUrl, params.apiKey));

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey || "lm-studio"}`,
      },
      body: JSON.stringify({
        model: model || undefined,
        messages: [{ role: "user", content: "Reply with the single word: pong" }],
        max_tokens: 16,
        temperature: 0,
        stream: false,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Could not reach ${url}. Is the local LLM server running? (${
        err instanceof Error ? err.message : String(err)
      })`,
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      error: `LLM returned HTTP ${response.status} ${response.statusText}. ${body.slice(0, 300)}`,
    };
  }

  let data: ChatCompletionResponse;
  try {
    data = (await response.json()) as ChatCompletionResponse;
  } catch {
    return { ok: false, error: "LLM responded but the body was not valid JSON." };
  }

  const reply = data.choices?.[0]?.message?.content?.trim() ?? "";
  return { ok: true, model: data.model ?? model, reply };
}
