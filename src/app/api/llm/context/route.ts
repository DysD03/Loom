import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

interface LmStudioModel {
  id: string;
  state?: string;
  max_context_length?: number;
  loaded_context_length?: number;
}

/**
 * Reports the context-window size (in tokens) of a local model, used by the chat
 * usage meter. LM Studio's native REST API (`/api/v0/models`) exposes context
 * length; we derive its base from the OpenAI-compatible base URL by dropping a
 * trailing `/v1`. Returns `contextLength: null` when it can't be determined
 * (e.g. a non-LM-Studio backend) so the meter simply hides.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const settings = getSettings();
  const requested = searchParams.get("model")?.trim() || settings.llmModel.trim();

  const oaiBase = settings.llmBaseUrl.replace(/\/+$/, "");
  const restBase = oaiBase.replace(/\/v1$/, "");

  try {
    const res = await fetch(`${restBase}/api/v0/models`, {
      headers: { Authorization: `Bearer ${settings.llmApiKey || "lm-studio"}` },
    });
    if (!res.ok) return Response.json({ model: requested || null, contextLength: null });

    const data = (await res.json()) as { data?: LmStudioModel[] };
    const models = data.data ?? [];

    // Prefer the explicitly requested model; otherwise the first loaded one.
    const match =
      (requested ? models.find((m) => m.id === requested) : undefined) ??
      models.find((m) => m.state === "loaded") ??
      null;

    if (!match) return Response.json({ model: requested || null, contextLength: null });

    const contextLength = match.loaded_context_length ?? match.max_context_length ?? null;
    return Response.json({
      model: match.id,
      contextLength,
      loaded: match.state === "loaded",
    });
  } catch {
    return Response.json({ model: requested || null, contextLength: null });
  }
}
