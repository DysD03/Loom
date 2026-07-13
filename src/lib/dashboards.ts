import "server-only";

import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { generateObject, generateText } from "ai";
import { z } from "zod";

import { db } from "@/db/client";
import { dashboards, type DashboardRow } from "@/db/schema";
import { getChatModel } from "./provider";
import {
  normalizeSpec,
  specFromMarkdown,
  type DashboardSpec,
} from "./dashboard-spec";

const TITLE_MAX = 80;
const MARKDOWN_MAX = 24_000;

export function listDashboards(): DashboardRow[] {
  return db.select().from(dashboards).orderBy(desc(dashboards.updatedAt)).all();
}

export function getDashboard(id: string): DashboardRow | undefined {
  return db.select().from(dashboards).where(eq(dashboards.id, id)).get();
}

export function createDashboard(input: {
  title: string;
  sourceMarkdown: string;
  sourceName: string;
}): DashboardRow {
  return db
    .insert(dashboards)
    .values({
      id: randomUUID(),
      title: input.title.trim().slice(0, TITLE_MAX) || "Untitled dashboard",
      sourceMarkdown: input.sourceMarkdown,
      sourceName: input.sourceName,
    })
    .returning()
    .get();
}

export function renameDashboard(id: string, title: string): DashboardRow | undefined {
  const trimmed = title.trim().slice(0, TITLE_MAX) || "Untitled dashboard";
  return db
    .update(dashboards)
    .set({ title: trimmed, updatedAt: new Date().toISOString() })
    .where(eq(dashboards.id, id))
    .returning()
    .get();
}

export function deleteDashboard(id: string): void {
  db.delete(dashboards).where(eq(dashboards.id, id)).run();
}

export function saveDashboardSource(id: string, markdown: string): DashboardRow | undefined {
  return db
    .update(dashboards)
    .set({ sourceMarkdown: markdown, updatedAt: new Date().toISOString() })
    .where(eq(dashboards.id, id))
    .returning()
    .get();
}

export function saveDashboardSpec(
  id: string,
  input: {
    spec: DashboardSpec;
    generatedBy: "model" | "fallback";
    model?: string | null;
    error?: string | null;
  },
): DashboardRow | undefined {
  return db
    .update(dashboards)
    .set({
      spec: JSON.stringify(input.spec),
      generatedBy: input.generatedBy,
      model: input.model ?? null,
      error: input.error ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(dashboards.id, id))
    .returning()
    .get();
}

/** Parses a row's stored spec JSON; null for corrupt or missing specs. */
export function loadSpec(row: DashboardRow): DashboardSpec | null {
  if (!row.spec) return null;
  try {
    return normalizeSpec(JSON.parse(row.spec));
  } catch {
    return null;
  }
}

// --- LLM generation ---

const sizeZ = z.enum(["sm", "md", "lg", "full"]);

const widgetZ = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stat"),
    label: z.string(),
    value: z.string(),
    delta: z.string().optional(),
    direction: z.enum(["up", "down", "flat"]).optional(),
    note: z.string().optional(),
    size: sizeZ.optional(),
  }),
  z.object({
    type: z.literal("chart"),
    chartType: z.enum(["bar", "line", "area", "donut"]),
    title: z.string(),
    categories: z.array(z.string()),
    series: z.array(z.object({ name: z.string(), data: z.array(z.number()) })),
    unit: z.string().optional(),
    size: sizeZ.optional(),
  }),
  z.object({
    type: z.literal("table"),
    title: z.string().optional(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
    size: sizeZ.optional(),
  }),
  z.object({
    type: z.literal("list"),
    title: z.string().optional(),
    items: z.array(z.string()),
    ordered: z.boolean().optional(),
    size: sizeZ.optional(),
  }),
  z.object({
    type: z.literal("progress"),
    label: z.string(),
    value: z.number(),
    max: z.number().optional(),
    unit: z.string().optional(),
    size: sizeZ.optional(),
  }),
  z.object({
    type: z.literal("callout"),
    tone: z.enum(["info", "success", "warning", "danger"]),
    title: z.string().optional(),
    text: z.string(),
    size: sizeZ.optional(),
  }),
  z.object({
    type: z.literal("text"),
    title: z.string().optional(),
    markdown: z.string(),
    size: sizeZ.optional(),
  }),
  z.object({
    type: z.literal("quote"),
    text: z.string(),
    attribution: z.string().optional(),
    size: sizeZ.optional(),
  }),
]);

const specZ = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  sections: z.array(
    z.object({ title: z.string().optional(), widgets: z.array(widgetZ) }),
  ),
});

const SYSTEM = `You design a dashboard from a Markdown document. Respond with a single JSON object:
{"title": string, "subtitle"?: string, "sections": [{"title"?: string, "widgets": [...]}]}

Widget shapes (each may add "size": "sm"|"md"|"lg"|"full"):
- {"type":"stat","label":string,"value":string,"delta"?:string,"direction"?:"up"|"down"|"flat","note"?:string} — one headline number.
- {"type":"chart","chartType":"bar"|"line"|"area"|"donut","title":string,"categories":[string],"series":[{"name":string,"data":[number]}],"unit"?:string} — every series' data aligns with categories. "unit" is "$", "%", etc.
- {"type":"table","columns":[string],"rows":[[string]],"title"?:string}
- {"type":"list","items":[string],"title"?:string,"ordered"?:boolean} — prefix an item with "[x] " or "[ ] " for checklists.
- {"type":"progress","label":string,"value":number,"max"?:number,"unit"?:string} — a ratio against a limit.
- {"type":"callout","tone":"info"|"success"|"warning"|"danger","text":string,"title"?:string} — warnings, risks, notes.
- {"type":"text","markdown":string,"title"?:string} — a SHORT prose summary (2-4 sentences).
- {"type":"quote","text":string,"attribution"?:string}

Rules:
- Use ONLY numbers that appear in the document. Never invent, estimate, or extrapolate data.
- Lead with 2-4 "stat" widgets when the document has headline numbers.
- Turn numeric Markdown tables into charts: "bar" to compare categories, "line"/"area" for change over time, "donut" ONLY for part-of-a-whole with at most 6 slices. Keep mixed or non-numeric tables as "table".
- Summarize prose into short "text" widgets — never copy long passages verbatim.
- Group related widgets into 1-5 sections with short titles. 6-16 widgets total.
- Charts and tables are "lg" or "full"; stats are "sm".`;

function buildPrompt(markdown: string, instructions?: string): string {
  const doc = markdown.slice(0, MARKDOWN_MAX);
  const guidance = instructions?.trim() ? `User guidance: ${instructions.trim()}\n\n` : "";
  return `MARKDOWN DOCUMENT:\n"""\n${doc}\n"""\n\n${guidance}Design the dashboard spec for this document.`;
}

/**
 * Asks the configured LLM for a dashboard spec — structured output first, then
 * a tolerant JSON-from-text fallback for models without it. Throws when the
 * model is unreachable or returns nothing renderable; callers degrade to
 * `specFromMarkdown` (create) or keep the previous spec (regenerate).
 */
export async function generateSpec(
  markdown: string,
  instructions?: string,
): Promise<{ spec: DashboardSpec; modelId: string }> {
  const { model, modelId } = getChatModel();
  if (!modelId) {
    throw new Error("No model configured. Set a model in Settings.");
  }
  const prompt = buildPrompt(markdown, instructions);

  try {
    const { object } = await generateObject({ model, schema: specZ, system: SYSTEM, prompt });
    const spec = normalizeSpec(object);
    if (!spec) {
      throw new Error("The model returned an empty dashboard.");
    }
    return { spec, modelId };
  } catch {
    const { text } = await generateText({
      model,
      system: `${SYSTEM}\n\nReturn ONLY the JSON object — no prose, no code fences.`,
      prompt,
    });
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error("The model did not return a dashboard spec.");
    }
    const spec = normalizeSpec(JSON.parse(text.slice(start, end + 1)));
    if (!spec) {
      throw new Error("The model's dashboard spec had no usable widgets.");
    }
    return { spec, modelId };
  }
}

/**
 * Generates and persists a spec for a dashboard row. When the model fails and
 * the row has no spec yet, the deterministic Markdown parser fills in (with the
 * model error recorded so the UI can say so); when a previous spec exists it is
 * kept untouched and the error is returned instead.
 */
export async function regenerateSpec(
  row: DashboardRow,
  instructions?: string,
): Promise<{ ok: true; generatedBy: "model" | "fallback" } | { error: string }> {
  try {
    const { spec, modelId } = await generateSpec(row.sourceMarkdown, instructions);
    saveDashboardSpec(row.id, { spec, generatedBy: "model", model: modelId });
    return { ok: true, generatedBy: "model" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "The model request failed.";
    if (row.spec) {
      return { error: message };
    }
    const spec = specFromMarkdown(row.sourceMarkdown, row.title);
    saveDashboardSpec(row.id, { spec, generatedBy: "fallback", error: message });
    return { ok: true, generatedBy: "fallback" };
  }
}
