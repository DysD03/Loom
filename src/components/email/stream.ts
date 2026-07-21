"use client";

/**
 * POSTs JSON and consumes the response either as a text stream (LLM output,
 * `onDelta` fires with the accumulated text) or as JSON (`{ summary }` for
 * cache hits). Throws with the server's error message on failure.
 */
export async function streamOrJson(
  url: string,
  body: unknown,
  onDelta: (accumulated: string) => void,
): Promise<{ text: string; cached: boolean }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }

  if (res.headers.get("content-type")?.includes("application/json")) {
    const data = (await res.json()) as { summary?: string; cached?: boolean };
    const text = data.summary ?? "";
    onDelta(text);
    return { text, cached: data.cached ?? false };
  }

  const reader = res.body?.getReader();
  if (!reader) {
    return { text: "", cached: false };
  }
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onDelta(text);
  }
  text += decoder.decode();
  onDelta(text);
  return { text, cached: false };
}
