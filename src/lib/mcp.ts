import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Tool as McpToolDef } from "@modelcontextprotocol/sdk/types.js";

import { db } from "@/db/client";
import { mcpServers, type McpServer } from "@/db/schema";
import { eq } from "drizzle-orm";

export type { McpToolDef };

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

/** Returns all tools from all enabled + connected servers. */
export async function getAllMcpTools(): Promise<McpToolWithServer[]> {
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
