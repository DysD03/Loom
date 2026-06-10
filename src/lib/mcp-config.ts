import "server-only";

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import type { McpTransport } from "@/db/schema";

/** Config file at the repo root that declares MCP servers (committed-by-you). */
export const MCP_CONFIG_FILENAME = "mcp.json";

/** One server parsed out of the config file. */
export interface McpConfigEntry {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
}

export interface McpConfigResult {
  entries: McpConfigEntry[];
  /** A human-readable problem with the file; entries is empty when set. */
  error?: string;
}

export function mcpConfigPath(): string {
  return join(process.cwd(), MCP_CONFIG_FILENAME);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Reads and validates `mcp.json` from the repo root. The format mirrors the
 * Claude Desktop / `.mcp.json` convention:
 *
 * ```json
 * {
 *   "mcpServers": {
 *     "filesystem": { "command": "npx", "args": ["-y", "pkg"], "env": { "K": "v" } },
 *     "remote":     { "url": "http://localhost:3001/sse" }
 *   }
 * }
 * ```
 *
 * A server with a `url` is treated as SSE/HTTP; otherwise it is stdio and needs
 * a `command`. `disabled: true` (or `enabled: false`) skips connecting it.
 * A missing file is not an error — it just yields no entries.
 */
export function readMcpConfig(): McpConfigResult {
  const path = mcpConfigPath();
  if (!existsSync(path)) return { entries: [] };

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return { entries: [], error: `Could not read ${MCP_CONFIG_FILENAME}: ${msg(err)}` };
  }
  if (!raw.trim()) return { entries: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { entries: [], error: `${MCP_CONFIG_FILENAME} is not valid JSON: ${msg(err)}` };
  }

  const servers = (parsed as { mcpServers?: unknown } | null)?.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return {
      entries: [],
      error: `${MCP_CONFIG_FILENAME} must have an "mcpServers" object at the top level.`,
    };
  }

  const entries: McpConfigEntry[] = [];
  for (const [name, value] of Object.entries(servers as Record<string, unknown>)) {
    if (!name.trim()) {
      return { entries: [], error: "Every server needs a non-empty name." };
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { entries: [], error: `Server "${name}" must be an object.` };
    }
    const v = value as Record<string, unknown>;

    const url = typeof v.url === "string" ? v.url.trim() : undefined;
    const command = typeof v.command === "string" ? v.command.trim() : undefined;
    const transport: McpTransport = url ? "sse" : "stdio";

    if (transport === "stdio" && !command) {
      return {
        entries: [],
        error: `Server "${name}" needs a "command" (or a "url" for an SSE/HTTP server).`,
      };
    }

    let args: string[] | undefined;
    if (v.args !== undefined) {
      if (!Array.isArray(v.args) || v.args.some((a) => typeof a !== "string")) {
        return { entries: [], error: `Server "${name}": "args" must be an array of strings.` };
      }
      args = v.args as string[];
    }

    let env: Record<string, string> | undefined;
    if (v.env !== undefined) {
      if (typeof v.env !== "object" || v.env === null || Array.isArray(v.env)) {
        return { entries: [], error: `Server "${name}": "env" must be an object of strings.` };
      }
      env = {};
      for (const [key, val] of Object.entries(v.env as Record<string, unknown>)) {
        if (typeof val !== "string") {
          return { entries: [], error: `Server "${name}": env var "${key}" must be a string.` };
        }
        env[key] = val;
      }
    }

    // "disabled" (Claude Desktop) and "enabled" both honored; default on.
    const enabled = v.disabled === true ? false : v.enabled !== false;

    entries.push({ name, transport, command, args, url, env, enabled });
  }

  return { entries };
}

/**
 * Removes a single server (by its key) from `mcp.json` and writes the file back,
 * preserving the rest. Used to delete a file-declared server from the UI — the
 * file is the source of truth, so the entry must come out of it to stay gone.
 */
export function removeMcpConfigEntry(name: string): { ok: boolean; error?: string } {
  const path = mcpConfigPath();
  if (!existsSync(path)) return { ok: false, error: `${MCP_CONFIG_FILENAME} not found` };

  let parsed: { mcpServers?: Record<string, unknown> };
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { ok: false, error: `${MCP_CONFIG_FILENAME} is not valid JSON: ${msg(err)}` };
  }

  const servers = parsed?.mcpServers;
  if (!servers || typeof servers !== "object" || !(name in servers)) {
    return { ok: false, error: `Server "${name}" is not in ${MCP_CONFIG_FILENAME}` };
  }

  delete servers[name];
  try {
    writeFileSync(path, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  } catch (err) {
    return { ok: false, error: `Could not write ${MCP_CONFIG_FILENAME}: ${msg(err)}` };
  }
  return { ok: true };
}
