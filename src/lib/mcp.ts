import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Tool as McpToolDef } from "@modelcontextprotocol/sdk/types.js";

import { db } from "@/db/client";
import { mcpServers, type McpServer } from "@/db/schema";
import { eq } from "drizzle-orm";

import { readMcpConfig } from "@/lib/mcp-config";

export type { McpToolDef };

/** Prefix marking a server whose definition is owned by the `mcp.json` file. */
const FILE_ID_PREFIX = "file:";

/** True when this server was declared in `mcp.json` (not added via the UI). */
export function isFileManaged(serverId: string): boolean {
  return serverId.startsWith(FILE_ID_PREFIX);
}

export interface McpToolWithServer extends McpToolDef {
  serverId: string;
  serverName: string;
}

interface Connection {
  client: Client;
  tools: McpToolDef[];
  status: "connected" | "error";
  error?: string;
}

// Global singleton so connections survive hot-reload in dev
const g = globalThis as typeof globalThis & {
  __mcpConnections?: Map<string, Connection>;
};
if (!g.__mcpConnections) {
  g.__mcpConnections = new Map();
}
const connections = g.__mcpConnections;

export async function connectServer(server: McpServer): Promise<Connection> {
  const existing = connections.get(server.id);
  if (existing?.status === "connected") return existing;

  const client = new Client({ name: "loom", version: "1.0.0" });

  try {
    if (server.transport === "stdio") {
      if (!server.command) throw new Error("stdio server missing command");
      const args: string[] = server.args ? (JSON.parse(server.args) as string[]) : [];
      const env: Record<string, string> = server.env
        ? (JSON.parse(server.env) as Record<string, string>)
        : {};
      const transport = new StdioClientTransport({
        command: server.command,
        args,
        env: { ...process.env, ...env } as Record<string, string>,
      });
      await client.connect(transport);
    } else {
      if (!server.url) throw new Error("SSE server missing url");
      const transport = new SSEClientTransport(new URL(server.url));
      await client.connect(transport);
    }

    const { tools } = await client.listTools();
    const conn: Connection = { client, tools, status: "connected" };
    connections.set(server.id, conn);
    return conn;
  } catch (err) {
    const conn: Connection = {
      client,
      tools: [],
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
    connections.set(server.id, conn);
    return conn;
  }
}

export async function disconnectServer(serverId: string): Promise<void> {
  const conn = connections.get(serverId);
  if (!conn) return;
  try {
    await conn.client.close();
  } catch {
    // ignore
  }
  connections.delete(serverId);
}

/** Re-connects (or connects fresh) a server and returns status + tool count. */
export async function pingServer(
  server: McpServer,
): Promise<{ ok: boolean; toolCount: number; error?: string }> {
  await disconnectServer(server.id);
  const conn = await connectServer(server);
  return {
    ok: conn.status === "connected",
    toolCount: conn.tools.length,
    error: conn.error,
  };
}

/**
 * Reconciles the `mcp.json` file into the `mcp_servers` table: file-declared
 * servers are upserted under a `file:<name>` id, and file-managed rows that have
 * since vanished from the file are removed. UI-added servers are untouched. A
 * cached connection is dropped only when that server's config actually changed,
 * so repeated syncs are cheap. Returns a file-level parse error, if any.
 */
export function syncMcpServersFromFile(): { error?: string } {
  const { entries, error } = readMcpConfig();
  if (error) return { error };

  const wanted = new Map(entries.map((e) => [FILE_ID_PREFIX + e.name, e]));
  const existing = db.select().from(mcpServers).all();
  const existingById = new Map(existing.map((s) => [s.id, s]));

  // Drop file-managed rows that are no longer declared in the file.
  for (const s of existing) {
    if (isFileManaged(s.id) && !wanted.has(s.id)) {
      void disconnectServer(s.id);
      db.delete(mcpServers).where(eq(mcpServers.id, s.id)).run();
    }
  }

  // Upsert each declared server.
  for (const [id, e] of wanted) {
    const row = {
      transport: e.transport,
      command: e.command ?? null,
      args: e.args ? JSON.stringify(e.args) : null,
      url: e.url ?? null,
      env: e.env ? JSON.stringify(e.env) : null,
      enabled: e.enabled,
    };
    const before = existingById.get(id);

    db.insert(mcpServers)
      .values({ id, name: e.name, ...row })
      .onConflictDoUpdate({
        target: mcpServers.id,
        set: { name: e.name, ...row, updatedAt: new Date().toISOString() },
      })
      .run();

    // Reconnect on the next use only when the connection-relevant config moved.
    if (
      before &&
      (before.transport !== row.transport ||
        before.command !== row.command ||
        before.args !== row.args ||
        before.url !== row.url ||
        before.env !== row.env)
    ) {
      void disconnectServer(id);
    }
  }

  return {};
}

/** Returns all tools from all enabled + connected servers. */
export async function getAllMcpTools(): Promise<McpToolWithServer[]> {
  try {
    syncMcpServersFromFile();
  } catch {
    // A bad config file must never break tool resolution for chat/agents.
  }

  const servers = db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.enabled, true))
    .all();

  const result: McpToolWithServer[] = [];
  for (const server of servers) {
    let conn = connections.get(server.id);
    if (!conn || conn.status === "error") {
      conn = await connectServer(server);
    }
    if (conn.status === "connected") {
      for (const tool of conn.tools) {
        result.push({ ...tool, serverId: server.id, serverName: server.name });
      }
    }
  }
  return result;
}

/** Calls a tool on the appropriate server. */
export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  let conn = connections.get(serverId);
  if (!conn || conn.status === "error") {
    const server = db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, serverId))
      .get();
    if (!server) throw new Error(`MCP server ${serverId} not found`);
    conn = await connectServer(server);
  }
  if (conn.status !== "connected") throw new Error(`MCP server ${serverId} not connected`);

  const result = await conn.client.callTool({ name: toolName, arguments: args });
  return result;
}
