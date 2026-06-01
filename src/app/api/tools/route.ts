import { listAvailableTools } from "@/lib/tools";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tools = await listAvailableTools();
    return Response.json({ tools });
  } catch {
    return Response.json({ tools: [] });
  }
}
