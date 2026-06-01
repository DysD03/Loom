import { getSettings } from "@/lib/settings";

interface ModelsResponse {
  data?: Array<{ id?: string }>;
}

/** Lists model ids exposed by the configured OpenAI-compatible server (`GET /models`). */
export async function GET() {
  const settings = getSettings();
  const baseUrl = settings.llmBaseUrl.replace(/\/+$/, "");

  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${settings.llmApiKey || "lm-studio"}` },
    });
    if (!res.ok) {
      return Response.json({ models: [], error: `HTTP ${res.status}` }, { status: 200 });
    }
    const data = (await res.json()) as ModelsResponse;
    const models = (data.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .sort((a, b) => a.localeCompare(b));
    return Response.json({ models });
  } catch (err) {
    return Response.json(
      { models: [], error: err instanceof Error ? err.message : String(err) },
      { status: 200 },
    );
  }
}
