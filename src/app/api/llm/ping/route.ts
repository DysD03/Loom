import { NextResponse } from "next/server";

import { getSettings } from "@/lib/settings";
import { pingLlm } from "@/lib/llm";

interface PingBody {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export async function POST(request: Request) {
  const body: PingBody = await request.json().catch(() => ({}));
  const settings = getSettings();

  const result = await pingLlm({
    baseUrl: body.baseUrl?.trim() || settings.llmBaseUrl,
    apiKey: body.apiKey?.trim() || settings.llmApiKey,
    model: body.model?.trim() || settings.llmModel,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
