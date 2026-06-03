import "server-only";

import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { generateText, streamText, type LanguageModel } from "ai";

import { db } from "@/db/client";
import { researchReports, type ResearchReport, type ResearchStatus } from "@/db/schema";
import { fetchReadable, searxngSearch } from "./web";

// Pipeline sizing — kept modest so the synthesis context fits a local model.
const MAX_QUERIES = 4;
const RESULTS_PER_QUERY = 4;
const MAX_SOURCES = 10;
const READ_COUNT = 5;
const READ_CHARS = 3500;

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
  /** True when the page was fetched and fed into the synthesis (and is cited as [n]). */
  used: boolean;
}

export type ResearchEvent =
  | { type: "status"; status: ResearchStatus }
  | { type: "plan"; queries: string[] }
  | { type: "sources"; sources: ResearchSource[] }
  | { type: "reading"; index: number; total: number; url: string; title: string }
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
  sources: ResearchSource[];
  report: string;
  status: ResearchStatus;
  error: string | null;
}

export function loadReport(row: ResearchReport): LoadedReport {
  const queries = safeJson<string[]>(row.plan, []);
  const sources = safeJson<ResearchSource[]>(row.sources, []);
  return {
    id: row.id,
    question: row.question,
    queries: Array.isArray(queries) ? queries : [],
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
  "You are a research planner. Given a question, produce a short list of focused web-search queries " +
  "that together would gather the evidence needed to answer it thoroughly. Cover distinct angles; avoid " +
  `near-duplicates. Return ONLY a JSON array of ${MAX_QUERIES} or fewer query strings, nothing else.`;

function parseQueries(text: string, fallback: string): string[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const arr = JSON.parse(match[0]) as unknown;
      if (Array.isArray(arr)) {
        const queries = arr
          .filter((q): q is string => typeof q === "string")
          .map((q) => q.trim())
          .filter(Boolean)
          .slice(0, MAX_QUERIES);
        if (queries.length) return queries;
      }
    } catch {
      // fall through to fallback
    }
  }
  return [fallback];
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

function buildSynthesisContext(question: string, read: { source: ResearchSource; text: string }[]): string {
  const blocks = read
    .map((r, i) => `[${i + 1}] ${r.source.title || r.source.url}\nURL: ${r.source.url}\n${r.text}`)
    .join("\n\n---\n\n");
  return `Question: ${question}\n\nSources:\n\n${blocks}`;
}

const SYNTHESIS_SYSTEM =
  "You are a meticulous research analyst. Using ONLY the numbered sources provided, write a clear, " +
  "well-structured Markdown report that answers the question. Cite every non-obvious claim inline with " +
  "bracketed numbers like [1] or [2][3] referring to the source numbers. Use headings and bullet points " +
  "where helpful, note disagreements or gaps between sources, and do NOT invent facts beyond the sources. " +
  "Do NOT write your own 'Sources' list — the app renders it from the citations.";

/**
 * Runs the full Deep Research pipeline as an async event stream, persisting a
 * `research_reports` row throughout. Yields progress + report-delta events.
 */
export async function* runResearch(opts: {
  conversationId: string;
  question: string;
  model: LanguageModel;
}): AsyncGenerator<ResearchEvent> {
  const { conversationId, question, model } = opts;
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

  try {
    // 1) Plan -----------------------------------------------------------------
    yield { type: "status", status: "planning" };
    let queries: string[];
    try {
      const { text } = await generateText({ model, system: PLAN_SYSTEM, prompt: question });
      queries = parseQueries(text, question);
    } catch {
      queries = [question];
    }
    touch({ plan: JSON.stringify(queries) });
    yield { type: "plan", queries };

    // 2) Search ---------------------------------------------------------------
    yield { type: "status", status: "searching" };
    const seen = new Set<string>();
    const discovered: ResearchSource[] = [];
    let searchErrors = 0;
    for (const q of queries) {
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

    if (discovered.length === 0) {
      const message =
        searchErrors > 0
          ? "Web search failed. Is SearXNG running with JSON enabled? (Settings → SearXNG URL)"
          : "No search results were found for this question.";
      touch({ status: "error", error: message });
      yield { type: "error", message };
      return;
    }

    const candidates = discovered.slice(0, MAX_SOURCES);
    yield { type: "sources", sources: candidates };

    // 3) Read -----------------------------------------------------------------
    yield { type: "status", status: "reading" };
    const toRead = candidates.slice(0, READ_COUNT);
    const read: { source: ResearchSource; text: string }[] = [];
    for (let i = 0; i < toRead.length; i++) {
      const src = toRead[i];
      yield {
        type: "reading",
        index: i + 1,
        total: toRead.length,
        url: src.url,
        title: src.title || src.url,
      };
      const result = await fetchReadable(src.url, READ_CHARS);
      if (result.text && result.text.trim().length > 200) {
        src.used = true;
        if (result.title && !src.title) src.title = result.title;
        read.push({ source: src, text: result.text });
      }
    }

    if (read.length === 0) {
      const message = "Found sources but could not read any of them (fetch blocked or empty).";
      touch({ status: "error", error: message, sources: JSON.stringify(candidates) });
      yield { type: "error", message };
      return;
    }

    // Order sources so the cited (used) ones come first, matching [n] numbering.
    const orderedSources: ResearchSource[] = [
      ...read.map((r) => r.source),
      ...candidates.filter((s) => !s.used),
    ];
    touch({ sources: JSON.stringify(orderedSources) });

    // 4) Synthesize -----------------------------------------------------------
    yield { type: "status", status: "writing" };
    const result = streamText({
      model,
      system: SYNTHESIS_SYSTEM,
      prompt: buildSynthesisContext(question, read),
    });

    let report = "";
    for await (const delta of result.textStream) {
      report += delta;
      yield { type: "report-delta", delta };
    }

    touch({ report, status: "done", sources: JSON.stringify(orderedSources) });
    yield { type: "done", reportId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    touch({ status: "error", error: message });
    yield { type: "error", message };
  }
}
