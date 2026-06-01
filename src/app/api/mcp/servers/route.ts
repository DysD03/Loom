import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

import { db } from "@/db/client";
import { mcpServers, type McpTransport } from "@/db/schema";
import { disconnectServer } from "@/lib/mcp";

export const dynamic = "force-dynamic";

export async function GET() {
  const servers = db.select().from(mcpServers).all();
  return Response.json(servers);
}

interface ServerBody {
  name?: string;
  transport?: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled?: boolean;
}

export async function POST(request: Request) {
  const body: ServerBody = await request.json().catch(() => ({}));
  const { name, transport, command, args, url, env, enabled } = body;

  if (!name?.trim()) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }
  if (transport !== "stdio" && transport !== "sse") {
    return Response.json({ error: "transport must be stdio or sse" }, { status: 400 });
  }
  if (transport === "stdio" && !command?.trim()) {
    return Response.json({ error: "command is required for stdio transport" }, { status: 400 });
  }
  if (transport === "sse" && !url?.trim()) {
    return Response.json({ error: "url is required for sse transport" }, { status: 400 });
  }

  const server = db
    .insert(mcpServers)
    .values({
      id: randomUUID(),
      name: name.trim(),
      transport,
      command: command?.trim() ?? null,
      args: args ? JSON.stringify(args) : null,
      url: url?.trim() ?? null,
      env: env ? JSON.stringify(env) : null,
      enabled: enabled ?? true,
    })
    .returning()
    .get();

  return Response.json(server, { status: 201 });
}

interface PatchBody {
  name?: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled?: boolean;
}

export async function PATCH(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const body: PatchBody = await request.json().catch(() => ({}));
  const update: Partial<typeof mcpServers.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (body.name !== undefined) update.name = body.name.trim();
  if (body.command !== undefined) update.command = body.command.trim();
  if (body.args !== undefined) update.args = JSON.stringify(body.args);
  if (body.url !== undefined) update.url = body.url.trim();
  if (body.env !== undefined) update.env = JSON.stringify(body.env);
  if (body.enabled !== undefined) update.enabled = body.enabled;

  const server = db
    .update(mcpServers)
    .set(update)
    .where(eq(mcpServers.id, id))
    .returning()
    .get();

  if (!server) return Response.json({ error: "server not found" }, { status: 404 });

  // Drop cached connection so it reconnects with new config
  await disconnectServer(id);
  return Response.json(server);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  await disconnectServer(id);
  db.delete(mcpServers).where(eq(mcpServers.id, id)).run();
  return new Response(null, { status: 204 });
}
