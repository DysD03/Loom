import "server-only";

import { tool, jsonSchema, dynamicTool, stepCountIs, type ToolSet } from "ai";
import { z } from "zod";

import { getSettings } from "./settings";
import { getAllMcpTools, callMcpTool } from "./mcp";

export { stepCountIs };

export interface ToolMeta {
  /** Registry key used in the AI SDK tools object. */
  key: string;
  name: string;
  description: string;
  source: "builtin" | "mcp";
  serverName?: string;
}

/** Built-in tool keys, kept stable so per-session toggles can reference them. */
export const BUILTIN_TOOL_KEYS = [
  "searchWeb",
  "readUrl",
  "calculator",
  "currentDateTime",
] as const;

// ---------------------------------------------------------------------------
// Built-in: SearXNG web search
// ---------------------------------------------------------------------------
function buildSearchTool() {
  const inputSchema = z.object({
    query: z.string().describe("The search query"),
    numResults: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .default(5)
      .describe("Number of results to return (1–10, default 5)"),
  });
  type Input = z.infer<typeof inputSchema>;

  return tool({
    description:
      "Search the web via a local SearXNG instance. Returns results with title, URL, and snippet.",
    inputSchema,
    execute: async ({ query, numResults }: Input) => {
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
        return { error: `SearXNG returned ${res.status}: ${res.statusText}` };
      }

      const data = (await res.json()) as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
      };

      const results = (data.results ?? []).slice(0, numResults).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
      }));

      return { results };
    },
  });
}

// ---------------------------------------------------------------------------
// Built-in: read a web page (fetch + strip HTML to readable text)
// ---------------------------------------------------------------------------
function htmlToText(html: string): string {
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

function buildReadUrlTool() {
  const inputSchema = z.object({
    url: z.string().url().describe("The absolute http(s) URL of the page to read"),
    maxChars: z
      .number()
      .int()
      .min(500)
      .max(20_000)
      .optional()
      .default(8_000)
      .describe("Maximum characters of extracted text to return (default 8000)"),
  });
  type Input = z.infer<typeof inputSchema>;

  return tool({
    description:
      "Fetch a web page by URL and return its readable text content (HTML stripped). " +
      "Use after searchWeb to read a result, or to read any known URL.",
    inputSchema,
    execute: async ({ url, maxChars }: Input) => {
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { "User-Agent": "Loom/1.0 (+local)", Accept: "text/html,*/*" },
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        return { error: `Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}` };
      }

      if (!res.ok) {
        return { error: `Fetch returned ${res.status} ${res.statusText} for ${url}` };
      }

      const contentType = res.headers.get("content-type") ?? "";
      const raw = await res.text();

      if (contentType.includes("application/json")) {
        return { url, contentType, text: raw.slice(0, maxChars) };
      }

      const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? htmlToText(titleMatch[1]) : "";
      const text = htmlToText(raw);
      const truncated = text.length > maxChars;

      return {
        url,
        title,
        text: text.slice(0, maxChars),
        truncated,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Built-in: calculator (dependency-free, eval-free recursive-descent parser)
// ---------------------------------------------------------------------------
/** Evaluates +, -, *, /, %, ^/** and parentheses with correct precedence. Throws on bad input. */
function evalExpression(expr: string): number {
  let i = 0;
  const s = expr;

  function skip() {
    while (i < s.length && (s[i] === " " || s[i] === "\t")) i++;
  }
  function parseExpr(): number {
    let value = parseTerm();
    for (;;) {
      skip();
      const op = s[i];
      if (op === "+" || op === "-") {
        i++;
        const rhs = parseTerm();
        value = op === "+" ? value + rhs : value - rhs;
      } else return value;
    }
  }
  function parseTerm(): number {
    let value = parseFactor();
    for (;;) {
      skip();
      const op = s[i];
      if (op === "*" || op === "/" || op === "%") {
        i++;
        const rhs = parseFactor();
        if (op === "*") value *= rhs;
        else if (op === "/") value /= rhs;
        else value %= rhs;
      } else return value;
    }
  }
  function parseFactor(): number {
    // Right-associative exponentiation.
    const base = parseUnary();
    skip();
    if (s[i] === "^" || (s[i] === "*" && s[i + 1] === "*")) {
      i += s[i] === "^" ? 1 : 2;
      return Math.pow(base, parseFactor());
    }
    return base;
  }
  function parseUnary(): number {
    skip();
    if (s[i] === "+") {
      i++;
      return parseUnary();
    }
    if (s[i] === "-") {
      i++;
      return -parseUnary();
    }
    return parsePrimary();
  }
  function parsePrimary(): number {
    skip();
    if (s[i] === "(") {
      i++;
      const value = parseExpr();
      skip();
      if (s[i] !== ")") throw new Error("missing closing parenthesis");
      i++;
      return value;
    }
    const start = i;
    while (i < s.length && /[0-9.eE]/.test(s[i])) {
      // allow exponent sign like 1e-3
      if ((s[i] === "e" || s[i] === "E") && (s[i + 1] === "+" || s[i + 1] === "-")) i++;
      i++;
    }
    const numStr = s.slice(start, i);
    if (!numStr) throw new Error(`unexpected token at position ${i}`);
    const num = Number(numStr);
    if (!Number.isFinite(num)) throw new Error(`invalid number "${numStr}"`);
    return num;
  }

  const result = parseExpr();
  skip();
  if (i !== s.length) throw new Error(`unexpected token "${s[i]}" at position ${i}`);
  return result;
}

function buildCalculatorTool() {
  const inputSchema = z.object({
    expression: z
      .string()
      .describe("Arithmetic expression, e.g. \"(3 + 4) * 2 ^ 3 / 7\". Supports + - * / % ^."),
  });
  type Input = z.infer<typeof inputSchema>;

  return tool({
    description:
      "Evaluate a numeric arithmetic expression precisely. Use for any non-trivial math " +
      "instead of computing it yourself. Supports + - * / % ^ and parentheses.",
    inputSchema,
    execute: async ({ expression }: Input) => {
      try {
        const result = evalExpression(expression);
        return { expression, result };
      } catch (err) {
        return { expression, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Built-in: current date/time
// ---------------------------------------------------------------------------
function buildDateTimeTool() {
  return tool({
    description:
      "Get the current date and time. Use this whenever the task depends on 'now' " +
      "(dates, deadlines, ages, recency) — do not guess the current date.",
    inputSchema: z.object({}),
    execute: async () => {
      const now = new Date();
      return {
        iso: now.toISOString(),
        local: now.toString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        unixMs: now.getTime(),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
/**
 * Builds the full AI SDK tools object: built-in tools + all enabled MCP tools.
 * When `enabledKeys` is provided, only tools whose registry key is in the list
 * are included (used by the Agents per-session tool toggles). `undefined` = all.
 */
export async function buildToolRegistry(enabledKeys?: string[]): Promise<ToolSet> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registry: Record<string, any> = {
    searchWeb: buildSearchTool(),
    readUrl: buildReadUrlTool(),
    calculator: buildCalculatorTool(),
    currentDateTime: buildDateTimeTool(),
  };

  const mcpTools = await getAllMcpTools();
  for (const mcpTool of mcpTools) {
    const key = `${mcpTool.serverName.replace(/\W+/g, "_")}__${mcpTool.name}`;
    const serverId = mcpTool.serverId;
    const toolName = mcpTool.name;

    registry[key] = dynamicTool({
      description: mcpTool.description ?? "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: jsonSchema(mcpTool.inputSchema as any),
      execute: async (args) => {
        return callMcpTool(serverId, toolName, args as Record<string, unknown>);
      },
    });
  }

  if (!enabledKeys) {
    return registry;
  }

  const allowed = new Set(enabledKeys);
  const filtered: ToolSet = {};
  for (const [key, value] of Object.entries(registry)) {
    if (allowed.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/** Returns metadata about available tools (for UI display + per-session toggles). */
export async function listAvailableTools(): Promise<ToolMeta[]> {
  const mcp = await getAllMcpTools();
  return [
    { key: "searchWeb", name: "searchWeb", description: "Search the web via SearXNG", source: "builtin" },
    { key: "readUrl", name: "readUrl", description: "Fetch a web page and read its text", source: "builtin" },
    { key: "calculator", name: "calculator", description: "Evaluate arithmetic expressions", source: "builtin" },
    {
      key: "currentDateTime",
      name: "currentDateTime",
      description: "Get the current date and time",
      source: "builtin",
    },
    ...mcp.map((t) => ({
      key: `${t.serverName.replace(/\W+/g, "_")}__${t.name}`,
      name: `${t.serverName}/${t.name}`,
      description: t.description ?? "",
      source: "mcp" as const,
      serverName: t.serverName,
    })),
  ];
}
