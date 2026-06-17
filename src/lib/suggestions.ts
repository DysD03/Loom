import "server-only";

import { generateObject, generateText, type LanguageModel } from "ai";
import { z } from "zod";

import { getUtilityModel } from "./provider";
import { formatMemoriesForPrompt, listMemories } from "./memory";

const suggestionSchema = z.object({
  title: z.string().describe("A short, specific label (3–7 words)."),
  surface: z
    .enum(["chat", "agent", "research"])
    .describe("'chat' to discuss/Q&A, 'agent' for a multi-step task using tools, 'research' for a cited web report."),
  prompt: z.string().describe("A ready-to-run message/question to seed the session, written to the assistant."),
});

const schema = z.object({ suggestions: z.array(suggestionSchema) });

export type Suggestion = z.infer<typeof suggestionSchema>;

const SYSTEM =
  "You suggest concrete, personalized next actions for a user of a local AI workspace, based on what " +
  "is known about them (their preferences, ongoing projects, goals, and context). Each suggestion is a " +
  "ready-to-run prompt tailored to their ACTUAL projects and goals — never generic filler. Pick the best " +
  "surface for each: 'chat' for discussion or quick Q&A, 'agent' for multi-step tasks that benefit from " +
  "tools/web, 'research' for questions that warrant a cited web report. Propose 3–6 varied suggestions.";

interface Extraction {
  suggestions: Suggestion[];
  outputTokens: number | undefined;
}

async function extract(model: LanguageModel, memoryBlock: string): Promise<Extraction> {
  const prompt = `${memoryBlock}\n\nPropose personalized next actions for this user.`;
  try {
    const { object, usage } = await generateObject({ model, schema, system: SYSTEM, prompt });
    return { suggestions: object.suggestions, outputTokens: usage.outputTokens };
  } catch {
    const { text, usage } = await generateText({
      model,
      system: `${SYSTEM}\n\nReturn ONLY JSON: {"suggestions":[{"title":string,"surface":"chat"|"agent"|"research","prompt":string}]}`,
      prompt,
    });
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { suggestions: [], outputTokens: usage.outputTokens };
    return {
      suggestions: schema.parse(JSON.parse(match[0])).suggestions,
      outputTokens: usage.outputTokens,
    };
  }
}

export interface SuggestionRun {
  suggestions: Suggestion[];
  /** Average generation speed over the run (wall time includes prompt processing). */
  tokensPerSecond: number | null;
}

/**
 * Generates personalized session suggestions from the user's stored memories.
 * Returns no suggestions when there are no memories; throws when no model is
 * configured.
 */
export async function generateSuggestions(): Promise<SuggestionRun> {
  const memories = listMemories();
  if (memories.length === 0) return { suggestions: [], tokensPerSecond: null };

  const { model, modelId } = getUtilityModel();
  if (!modelId) throw new Error("No model configured. Set a model in Settings.");

  const memoryBlock = formatMemoriesForPrompt(memories);
  const startedAt = Date.now();
  const { suggestions, outputTokens } = await extract(model, memoryBlock);
  const seconds = (Date.now() - startedAt) / 1000;
  const tokens = outputTokens ?? Math.ceil(JSON.stringify(suggestions).length / 4);
  return {
    suggestions: suggestions.filter((s) => s.title.trim() && s.prompt.trim()).slice(0, 6),
    tokensPerSecond: seconds > 0 && tokens > 0 ? tokens / seconds : null,
  };
}
