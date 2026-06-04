import { NotebookPen } from "lucide-react";

import { EditorList } from "@/components/editor/editor-list";
import { EditorView } from "@/components/editor/editor-view";
import { getEditorDocument, listEditorDocuments } from "@/lib/editor";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function EditorPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const { d } = await searchParams;
  const docs = listEditorDocuments();
  const active = d ? getEditorDocument(d) : undefined;
  const embeddingsConfigured = Boolean(getSettings().embeddingsModel.trim());

  return (
    <div className="flex h-full">
      <EditorList
        documents={docs.map((doc) => ({ id: doc.id, title: doc.title }))}
        activeId={active?.id}
      />
      {active ? (
        <EditorView
          key={active.id}
          doc={{
            id: active.id,
            title: active.title,
            content: active.content,
            indexed: Boolean(active.documentId),
          }}
          embeddingsConfigured={embeddingsConfigured}
        />
      ) : (
        <div className="animate-fade-in-up flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <NotebookPen className="text-neon-cyan size-9 drop-shadow-[0_0_10px_var(--neon-cyan)]" />
          <div className="space-y-3">
            <p className="font-pixel text-glow-magenta text-primary text-sm leading-relaxed">
              WRITE A DOCUMENT
              <span className="bg-neon-cyan animate-blink ml-1 inline-block h-3 w-2 align-middle" />
            </p>
            <p className="text-muted-foreground text-sm">
              Pick a document on the left or create a new one. The assistant can verify use
              cases, and saved docs feed Chat &amp; Agents.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
