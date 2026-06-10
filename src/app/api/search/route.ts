import { globalSearch } from "@/lib/search";

export function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json({ results: globalSearch(q) });
}
