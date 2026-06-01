import "server-only";

import { tool, jsonSchema, dynamicTool, stepCountIs, type ToolSet } from "ai";
import { z } from "zod";

import { getSettings } from "./settings";
import { getAllMcpTools, callMcpTool } from "./mcp";

export { stepCountIs };

export interface ToolMeta {
  name: string;
  description: string;
  source: "builtin" | "mcp";
  serverName?: string;
}

// Built-in SearXNG web search tool
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

/** Builds the full AI SDK tools object: built-in SearXNG + all enabled MCP tools. */
export async function buildToolRegistry(): Promise<ToolSet> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registry: Record<string, any> = {
    searchWeb: buildSearchTool(),
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

  return registry;
}

/** Returns metadata about available tools (for UI display). */
export async function listAvailableTools(): Promise<ToolMeta[]> {
  const mcp = await getAllMcpTools();
  return [
    { name: "searchWeb", description: "Search the web via SearXNG", source: "builtin" },
    ...mcp.map((t) => ({
      name: `${t.serverName}/${t.name}`,
      description: t.description ?? "",
      source: "mcp" as const,
      serverName: t.serverName,
    })),
  ];
}
