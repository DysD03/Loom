"use server";

import { revalidatePath } from "next/cache";

import { saveSettings, type SettingsInput } from "@/lib/settings";

export async function updateSettings(input: SettingsInput) {
  const saved = saveSettings({
    llmBaseUrl: input.llmBaseUrl.trim(),
    llmApiKey: input.llmApiKey.trim() || "lm-studio",
    llmModel: input.llmModel.trim(),
    ollamaBaseUrl: input.ollamaBaseUrl.trim(),
    ollamaApiKey: input.ollamaApiKey.trim() || "ollama",
    utilityModel: input.utilityModel.trim(),
    embeddingsModel: input.embeddingsModel.trim(),
    anthropicApiKey: input.anthropicApiKey.trim(),
    openaiApiKey: input.openaiApiKey.trim(),
    googleApiKey: input.googleApiKey.trim(),
    searxngUrl: input.searxngUrl.trim(),
    computeCostPerHour: Number.isFinite(input.computeCostPerHour)
      ? Math.max(0, input.computeCostPerHour)
      : 0,
  });
  revalidatePath("/settings");
  return saved;
}
