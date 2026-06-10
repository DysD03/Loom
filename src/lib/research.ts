import "server-only";

import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { generateText, streamText, type LanguageModel } from "ai";

import { db } from "@/db/client";
import { researchReports, type ResearchReport, type ResearchStatus } from "@/db/schema";
import { fetchReadable, searxngSearch } from "./web";
import { retrieveRelevantChunks, type RetrievedChunk } from "./documents";
import { DEFAULT_RESEARCH_TOOLS, type ResearchToolKey } from "./research-config";

// Pipeline sizing — an iterative, DeepResearch-style loop. Each round searches,
// reads, then reflects on gaps and decides the next round's queries (or stops
// early). Kept modest so the running context fits a local model.
const MAX_ROUNDS = 3; // depth: how many search→read→reflect cycles at most
const QUERIES_PER_ROUND = 3; // breadth: queries issued each round
const RESULTS_PER_QUERY = 4;
const READ_PER_ROUND = 3; // pages fetched + read each round
const MAX_TOTAL_SOURCES = 30; // cap on discovered sources kept around
const READ_CHARS = 3500; // chars kept per page when reading
const DOC_CHUNKS_PER_ROUND = 4; // local knowledge-base excerpts pulled per round
const REFLECT_CHARS = 1400; // chars per page fed into the reflection step
const SYNTH_CHARS = 2600; // chars per cited source fed into final synthesis

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
  /** True when the page was fetched and fed into the synthesis (and is cited as [n]). */
  used: boolean;
}

/** One iteration of the research loop, surfaced to the UI as a live log. */
export interface ResearchRound {
  index: number;
  max: number;
  /** What this round is trying to find out. */
  goal: string;
  /** Queries issued this round. */
  queries: string[];
  /** Key facts extracted from this round's reading. */
  learnings: string[];
  /** What is still missing after this round. */
  gaps: string[];
  /** Whether the agent judged the evidence sufficient to stop. */
  sufficient: boolean;
}

export type ResearchEvent =
  | { type: "status"; status: ResearchStatus }
  | { type: "plan"; queries: string[] }
  | { type: "round"; index: number; max: number; goal: string; queries: string[] }
  | { type: "sources"; sources: ResearchSource[] }
  | { type: "reading"; index: number; total: number; url: string; title: string }
  | {
      type: "reflection";
      round: number;
      learnings: string[];
      gaps: string[];
      sufficient: boolean;
    }
  | { type: "report-delta"; delta: string }
  | { type: "done"; reportId: string }
  | { type: "error"; message: string };

export function getLatestReport(conversationId: string): ResearchReport | undefined {
  return db
    .select()
    .from(researchReports)
    .where(eq(researchReports.conversationId, conversationId))
    .orderBy(desc(researchReports.createdAt))
    .limit(1)
    .get();
}

/** Parsed view of a persisted report for the UI. */
export interface LoadedReport {
  id: string;
  question: string;
  queries: string[];
  rounds: ResearchRound[];
  sources: ResearchSource[];
  report: string;
  status: ResearchStatus;
  error: string | null;
}

/**
 * The `plan` column stores a JSON object once the iterative loop landed; older
 * rows stored a bare string[] of queries. Read both shapes.
 */
interface StoredPlan {
  queries: string[];
  rounds: ResearchRound[];
}

export function loadReport(row: ResearchReport): LoadedReport {
  const plan = safeJson<StoredPlan | string[]>(row.plan, { queries: [], rounds: [] });
  const sources = safeJson<ResearchSource[]>(row.sources, []);
  const queries = Array.isArray(plan) ? plan : (plan.queries ?? []);
  const rounds = Array.isArray(plan) ? [] : (plan.rounds ?? []);
  return {
    id: row.id,
    question: row.question,
    queries: Array.isArray(queries) ? queries : [],
    rounds: Array.isArray(rounds) ? rounds : [],
    sources: Array.isArray(sources) ? sources : [],
    report: row.report,
    status: row.status,
    error: row.error,
  };
}

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const PLAN_SYSTEM =
  "You are a research planner opening a deep-research investigation. Given a question, produce a short " +
  "list of focused, complementary web-search queries that begin gathering the evidence needed to answer " +
  "it. Cover distinct angles; avoid near-duplicates. Return ONLY a JSON array of " +
  `${QUERIES_PER_ROUND} or fewer query strings, nothing else.`;

const REFLECT_SYSTEM =
  "You are a research strategist running an iterative deep-research loop. You receive the user's question, " +
  "the findings gathered so far, and excerpts from the sources just read this round. Do three things:\n" +
  "1) Extract the key NEW, concrete facts or insights relevant to the question from the new excerpts. Each " +
  "learning must be a self-contained sentence; do not include citations or source numbers.\n" +
  "2) Identify what is still MISSING, uncertain, or contradictory and needs verifying to answer the question fully (gaps).\n" +
  `3) Propose up to ${QUERIES_PER_ROUND} focused web-search queries that would close those gaps next round. ` +
  "If the question is already well covered, return an empty queries array and set sufficient to true.\n" +
  'Return ONLY a JSON object: {"learnings": string[], "gaps": string[], "nextQueries": string[], "sufficient": boolean}.';

const SYNTHESIS_SYSTEM =
  "You are a meticulous research analyst writing the final report of a deep-research investigation. Using " +
  "ONLY the numbered sources provided (the running findings are context, but every claim must be grounded " +
  "in the sources), write a clear, well-structured Markdown report that thoroughly answers the question. " +
  "Open with a short summary, then organize the body with headings and bullet points. Cite every " +
  "non-obvious claim inline with bracketed numbers like [1] or [2][3] referring to the source numbers. " +
  "Note disagreements or gaps between sources, and do NOT invent facts beyond the sources. Do NOT write " +
  "your own 'Sources' list — the app renders it from the citations.";

function parseQueries(text: string, fallback: string): string[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const arr = JSON.parse(match[0]) as unknown;
      if (Array.isArray(arr)) {
        const queries = cleanQueries(arr);
        if (queries.length) return queries;
      }
    } catch {
      // fall through to fallback
    }
  }
  return [fallback];
}

function cleanQueries(arr: unknown[]): string[] {
  return arr
    .filter((q): q is string => typeof q === "string")
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, QUERIES_PER_ROUND);
}

interface Reflection {
  learnings: string[];
  gaps: string[];
  nextQueries: string[];
  sufficient: boolean;
}

/** Tolerant parse of the reflection step's JSON object (handles surrounding prose). */
function parseReflection(text: string): Reflection {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      return {
        learnings: toStringArray(obj.learnings),
        gaps: toStringArray(obj.gaps),
        nextQueries: cleanQueries(Array.isArray(obj.nextQueries) ? obj.nextQueries : []),
        sufficient: obj.sufficient === true,
      };
    } catch {
      // fall through
    }
  }
  return { learnings: [], gaps: [], nextQueries: [], sufficient: false };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Pulls deduped local knowledge-base excerpts relevant to this round's queries. */
async function retrieveDocChunks(
  queries: string[],
  seen: Set<string>,
): Promise<RetrievedChunk[]> {
  const out: RetrievedChunk[] = [];
  for (const q of queries) {
    if (out.length >= DOC_CHUNKS_PER_ROUND) break;
    let chunks: RetrievedChunk[] = [];
    try {
      chunks = await retrieveRelevantChunks(q, DOC_CHUNKS_PER_ROUND);
    } catch {
      chunks = [];
    }
    for (const c of chunks) {
      const key = `${c.documentId}#${c.chunkIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
      if (out.length >= DOC_CHUNKS_PER_ROUND) break;
    }
  }
  return out;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

interface ReadPage {
  source: ResearchSource;
  text: string;
}

function buildReflectContext(question: string, findings: string[], fresh: ReadPage[]): string {
  const findingsBlock = findings.length
    ? findings.map((f) => `- ${f}`).join("\n")
    : "(none yet)";
  const sourceBlock = fresh
    .map((r, i) => `[${i + 1}] ${r.source.title || r.source.url}\n${r.text.slice(0, REFLECT_CHARS)}`)
    .join("\n\n---\n\n");
  return `Question: ${question}\n\nFindings so far:\n${findingsBlock}\n\nNew source excerpts this round:\n\n${sourceBlock}`;
}

function buildSynthesisContext(question: string, findings: string[], read: ReadPage[]): string {
  const findingsBlock = findings.length
    ? `Running findings (for context):\n${findings.map((f) => `- ${f}`).join("\n")}\n\n`
    : "";
  const blocks = read
    .map(
      (r, i) =>
        `[${i + 1}] ${r.source.title || r.source.url}\nURL: ${r.source.url}\n${r.text.slice(0, SYNTH_CHARS)}`,
    )
    .join("\n\n---\n\n");
  return `Question: ${question}\n\n${findingsBlock}Sources:\n\n${blocks}`;
}

/**
 * Runs the full iterative Deep Research pipeline as an async event stream,
 * persisting a `research_reports` row throughout. Plans queries, then loops
 * search → read → reflect (gap analysis + adaptive next queries, with early
 * stopping), and finally synthesizes a cited Markdown report. Yields progress,
 * per-round, and report-delta events.
 */
export async function* runResearch(opts: {
  conversationId: string;
  question: string;
  model: LanguageModel;
  /** Max search→read→reflect rounds; defaults to MAX_ROUNDS. */
  maxRounds?: number;
  /** Enabled data sources; defaults to web search + reading. */
  tools?: ResearchToolKey[];
}): AsyncGenerator<ResearchEvent> {
  const { conversationId, question, model } = opts;
  const maxRounds = Math.min(6, Math.max(1, opts.maxRounds ?? MAX_ROUNDS));
  const enabled = new Set<ResearchToolKey>(opts.tools ?? DEFAULT_RESEARCH_TOOLS);
  const useWeb = enabled.has("searchWeb");
  const useRead = enabled.has("readUrl");
  const useDocs = enabled.has("searchDocuments");
  const now = new Date().toISOString();
  const reportId = randomUUID();

  db.insert(researchReports)
    .values({ id: reportId, conversationId, question, status: "planning", createdAt: now, updatedAt: now })
    .run();

  const touch = (patch: Partial<ResearchReport>) =>
    db
      .update(researchReports)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(researchReports.id, reportId))
      .run();

  // Accumulated across rounds — the loop's evolving memory.
  const seen = new Set<string>();
  const seenDocChunks = new Set<string>();
  const discovered: ResearchSource[] = [];
  const read: ReadPage[] = [];
  const findings: string[] = [];
  const rounds: ResearchRound[] = [];
  const allQueries: string[] = [];

  const persistPlan = () =>
    touch({ plan: JSON.stringify({ queries: allQueries, rounds }) });
  const orderedSources = (): ResearchSource[] => [
    ...read.map((r) => r.source),
    ...discovered.filter((s) => !s.used),
  ];

  try {
    // 1) Initial plan --------------------------------------------------------
    yield { type: "status", status: "planning" };
    let nextQueries: string[];
    try {
      const { text } = await generateText({ model, system: PLAN_SYSTEM, prompt: question });
      nextQueries = parseQueries(text, question);
    } catch {
      nextQueries = [question];
    }
    allQueries.push(...nextQueries);
    persistPlan();
    yield { type: "plan", queries: nextQueries };

    let searchErrors = 0;

    // 2) Iterative rounds ----------------------------------------------------
    for (let round = 1; round <= maxRounds && nextQueries.length > 0; round++) {
      const goal =
        round === 1
          ? question
          : rounds[round - 2]?.gaps.join("; ") || "Fill remaining gaps";
      const roundLog: ResearchRound = {
        index: round,
        max: maxRounds,
        goal,
        queries: nextQueries,
        learnings: [],
        gaps: [],
        sufficient: false,
      };
      rounds.push(roundLog);
      yield { type: "round", index: round, max: maxRounds, goal, queries: nextQueries };

      // 2a) Search the web --------------------------------------------------
      if (useWeb) {
        yield { type: "status", status: "searching" };
        for (const q of nextQueries) {
          if (discovered.length >= MAX_TOTAL_SOURCES) break;
          try {
            const results = await searxngSearch(q, RESULTS_PER_QUERY);
            for (const r of results) {
              const key = normalizeUrl(r.url);
              if (!r.url || seen.has(key)) continue;
              seen.add(key);
              discovered.push({ title: r.title, url: r.url, snippet: r.snippet, used: false });
            }
          } catch {
            searchErrors += 1;
          }
        }

        if (discovered.length === 0 && !useDocs) {
          const message =
            searchErrors > 0
              ? "Web search failed. Is SearXNG running with JSON enabled? (Settings → SearXNG URL)"
              : "No search results were found for this question.";
          touch({ status: "error", error: message });
          yield { type: "error", message };
          return;
        }
        if (discovered.length > 0) {
          yield { type: "sources", sources: discovered.slice(0, MAX_TOTAL_SOURCES) };
        }
      }

      // 2b) Gather evidence: read web pages + consult local documents -------
      yield { type: "status", status: "reading" };
      const fresh: ReadPage[] = [];

      if (useWeb) {
        const toRead = discovered.filter((s) => !s.used).slice(0, READ_PER_ROUND);
        for (let i = 0; i < toRead.length; i++) {
          const src = toRead[i];
          yield {
            type: "reading",
            index: i + 1,
            total: toRead.length,
            url: src.url,
            title: src.title || src.url,
          };
          if (useRead) {
            const result = await fetchReadable(src.url, READ_CHARS);
            if (result.text && result.text.trim().length > 200) {
              src.used = true;
              if (result.title && !src.title) src.title = result.title;
              const page = { source: src, text: result.text };
              read.push(page);
              fresh.push(page);
            }
          } else if (src.snippet.trim()) {
            // Snippet-only mode: use the search snippet as the evidence.
            src.used = true;
            const page = { source: src, text: src.snippet };
            read.push(page);
            fresh.push(page);
          }
        }
      }

      if (useDocs) {
        for (const chunk of await retrieveDocChunks(nextQueries, seenDocChunks)) {
          const source: ResearchSource = {
            title: `${chunk.documentTitle} (your documents)`,
            url: `loom-doc://${chunk.documentId}#${chunk.chunkIndex}`,
            snippet: "",
            used: true,
          };
          const page = { source, text: chunk.content };
          discovered.push(source);
          read.push(page);
          fresh.push(page);
        }
      }
      touch({ sources: JSON.stringify(orderedSources()) });

      // 2c) Reflect — extract learnings, find gaps, plan next round ----------
      yield { type: "status", status: "reflecting" };
      let reflection: Reflection = { learnings: [], gaps: [], nextQueries: [], sufficient: false };
      if (fresh.length > 0) {
        try {
          const { text } = await generateText({
            model,
            system: REFLECT_SYSTEM,
            prompt: buildReflectContext(question, findings, fresh),
          });
          reflection = parseReflection(text);
        } catch {
          // keep the empty reflection; the loop will stop if no next queries
        }
      }

      findings.push(...reflection.learnings);
      roundLog.learnings = reflection.learnings;
      roundLog.gaps = reflection.gaps;
      roundLog.sufficient = reflection.sufficient;
      persistPlan();
      yield {
        type: "reflection",
        round,
        learnings: reflection.learnings,
        gaps: reflection.gaps,
        sufficient: reflection.sufficient,
      };

      if (reflection.sufficient) break;
      // Only queries we haven't already issued, so rounds keep making progress.
      nextQueries = reflection.nextQueries.filter(
        (q) => !allQueries.some((prev) => prev.toLowerCase() === q.toLowerCase()),
      );
      allQueries.push(...nextQueries);
      persistPlan();
    }

    if (read.length === 0) {
      const message = "Found sources but could not read any of them (fetch blocked or empty).";
      touch({ status: "error", error: message, sources: JSON.stringify(discovered) });
      yield { type: "error", message };
      return;
    }

    // 3) Final synthesis -----------------------------------------------------
    yield { type: "status", status: "writing" };
    const result = streamText({
      model,
      system: SYNTHESIS_SYSTEM,
      prompt: buildSynthesisContext(question, findings, read),
    });

    let report = "";
    for await (const delta of result.textStream) {
      report += delta;
      yield { type: "report-delta", delta };
    }

    touch({ report, status: "done", sources: JSON.stringify(orderedSources()) });
    yield { type: "done", reportId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    touch({ status: "error", error: message });
    yield { type: "error", message };
  }
}

/**
 * Renders a finished report as a self-contained Markdown document (title +
 * report body + a Sources list whose [n] match the inline citations). Used when
 * exporting a report to the Editor tab.
 */
export function reportToMarkdown(report: LoadedReport): { title: string; content: string } {
  const title = report.question.trim() || "Research report";
  const used = report.sources.filter((s) => s.used);
  const parts = [`# ${title}`, "", report.report.trim()];
  if (used.length > 0) {
    parts.push("", "## Sources", "");
    used.forEach((s, i) => {
      const isWeb = /^https?:\/\//i.test(s.url);
      parts.push(isWeb ? `${i + 1}. [${s.title || s.url}](${s.url})` : `${i + 1}. ${s.title || s.url}`);
    });
  }
  return { title, content: parts.join("\n") };
}
