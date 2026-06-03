import "server-only";

import { getSettings } from "./settings";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ReadResult {
  url: string;
  title?: string;
  text?: string;
  truncated?: boolean;
  contentType?: string;
  error?: string;
}

/** Strips HTML to readable plain text (no DOM, dependency-free). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|h[1-6]|li|br|tr|section|article|header|footer)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Queries the configured local SearXNG instance's JSON API.
 * Throws on transport/HTTP failure so callers can surface a clear message.
 */
export async function searxngSearch(query: string, numResults = 5): Promise<SearchResult[]> {
  const settings = getSettings();
  const base = settings.searxngUrl.replace(/\/$/, "");
  const url = new URL(`${base}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", "general");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`SearXNG returned ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (data.results ?? []).slice(0, numResults).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }));
}

/** Fetches a URL and returns its readable text (HTML stripped). Never throws. */
export async function fetchReadable(url: string, maxChars = 8_000): Promise<ReadResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Loom/1.0 (+local)", Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { url, error: `Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!res.ok) {
    return { url, error: `Fetch returned ${res.status} ${res.statusText} for ${url}` };
  }

  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();

  if (contentType.includes("application/json")) {
    return { url, contentType, text: raw.slice(0, maxChars) };
  }

  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? htmlToText(titleMatch[1]) : "";
  const text = htmlToText(raw);
  return { url, title, text: text.slice(0, maxChars), truncated: text.length > maxChars };
}
