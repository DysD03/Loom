import { ingestDocument, listDocuments } from "@/lib/documents";

export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file

export function GET() {
  return Response.json({ documents: listDocuments() });
}

/**
 * Uploads one or more files (multipart form, field name "files"), parsing,
 * chunking, embedding, and storing each. Returns the resulting document rows.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected a multipart form upload." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return Response.json({ error: "No files provided." }, { status: 400 });
  }

  const results = [];
  const errors: string[] = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      errors.push(`${file.name}: file exceeds 25 MB limit.`);
      continue;
    }
    try {
      const buffer = await file.arrayBuffer();
      const doc = await ingestDocument({
        title: file.name.replace(/\.[^.]+$/, ""),
        filename: file.name,
        mimeType: file.type,
        buffer,
      });
      results.push(doc);
    } catch (err) {
      errors.push(`${file.name}: ${err instanceof Error ? err.message : "failed to ingest"}`);
    }
  }

  return Response.json({ documents: results, errors });
}
