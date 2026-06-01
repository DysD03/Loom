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

/**
 * Sends a minimal chat completion to the configured OpenAI-compatible endpoint
 * to confirm the local LLM is reachable and a model is loaded.
 */
export async function pingLlm(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): Promise<PingResult> {
  const baseUrl = params.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey || "lm-studio"}`,
      },
      body: JSON.stringify({
        model: params.model || undefined,
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
  return { ok: true, model: data.model ?? params.model, reply };
}
