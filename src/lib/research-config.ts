/**
 * Pure Deep Research configuration constants + types — no server-only deps, so
 * both client components (the settings popover) and server modules can import it.
 */

/**
 * Deep Research data sources / tools the pipeline may use. `searchWeb` discovers
 * sources via SearXNG, `readUrl` fetches+reads full pages (vs. snippets only),
 * and `searchDocuments` folds the local knowledge base into the evidence.
 */
export const RESEARCH_TOOL_KEYS = ["searchWeb", "readUrl", "searchDocuments"] as const;
export type ResearchToolKey = (typeof RESEARCH_TOOL_KEYS)[number];

export const DEFAULT_RESEARCH_ROUNDS = 3;
export const RESEARCH_ROUNDS_MIN = 1;
export const RESEARCH_ROUNDS_MAX = 6;
export const DEFAULT_RESEARCH_TOOLS: ResearchToolKey[] = ["searchWeb", "readUrl"];

/** Per-session Deep Research configuration. */
export interface ResearchConfig {
  /** Max search→read→reflect rounds. */
  maxRounds: number;
  /** Enabled data-source keys. */
  tools: ResearchToolKey[];
}
