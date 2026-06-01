import { db } from "@/db/client";
import { mcpServers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { pingServer } from "@/lib/mcp";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { id } = await request.json().catch(() => ({})) as { id?: string };
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const server = db.select().from(mcpServers).where(eq(mcpServers.id, id)).get();
  if (!server) return Response.json({ error: "server not found" }, { status: 404 });

  const result = await pingServer(server);
  return Response.json(result);
}
