import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { appSettings, type AppSettings } from "@/db/schema";

const SETTINGS_ID = 1;

/** Fields a user is allowed to edit from the Settings page. */
export type SettingsInput = Pick<
  AppSettings,
  | "llmBaseUrl"
  | "llmApiKey"
  | "llmModel"
  | "ollamaBaseUrl"
  | "ollamaApiKey"
  | "utilityModel"
  | "embeddingsModel"
  | "anthropicApiKey"
  | "openaiApiKey"
  | "googleApiKey"
  | "searxngUrl"
  | "computeCostPerHour"
  | "tokenPricing"
>;

/** Returns the settings row, creating it with defaults on first access. */
export function getSettings(): AppSettings {
  const existing = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, SETTINGS_ID))
    .get();

  if (existing) {
    return existing;
  }

  return db.insert(appSettings).values({ id: SETTINGS_ID }).returning().get();
}

/**
 * Pins (or with "" clears) the benchmark run used as the comparison baseline.
 * Deliberately outside `SettingsInput`: it is set from the benchmarks page, so
 * a save of the settings form must never clear it as a side effect.
 */
export function setBaselineRun(runId: string): void {
  getSettings();
  db.update(appSettings)
    .set({ baselineRunId: runId, updatedAt: new Date().toISOString() })
    .where(eq(appSettings.id, SETTINGS_ID))
    .run();
}

export function saveSettings(input: SettingsInput): AppSettings {
  getSettings();
  return db
    .update(appSettings)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(eq(appSettings.id, SETTINGS_ID))
    .returning()
    .get();
}
