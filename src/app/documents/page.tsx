import { getSettings } from "@/lib/settings";
import { listDocuments } from "@/lib/documents";
import { DocumentsView } from "@/components/documents/documents-view";

export const dynamic = "force-dynamic";

export default function DocumentsPage() {
  const rows = listDocuments();
  const embeddingsConfigured = Boolean(getSettings().embeddingsModel.trim());

  const docs = rows.map((d) => ({
    id: d.id,
    title: d.title,
    filename: d.filename,
    kind: d.kind,
    sizeBytes: d.sizeBytes,
    charCount: d.charCount,
    chunkCount: d.chunkCount,
    status: d.status,
    error: d.error,
    createdAt: d.createdAt,
  }));

  const ready = docs.filter((d) => d.status === "ready").length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
        <h1 className="text-base font-semibold">Documents</h1>
        <span className="text-muted-foreground text-xs">
          {ready} ready · {docs.length} total
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <DocumentsView documents={docs} embeddingsConfigured={embeddingsConfigured} />
      </div>
    </div>
  );
}
