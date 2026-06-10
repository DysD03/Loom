"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  FileText,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import type { DocumentStatus } from "@/db/schema";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  deleteDocumentAction,
  ingestUrlAction,
  renameDocumentAction,
} from "@/app/documents/actions";

const ACCEPT = ".pdf,.txt,.md,.markdown,.csv,.json,.log,.tsv,.yaml,.yml";

interface DocumentView {
  id: string;
  title: string;
  filename: string;
  kind: string;
  sizeBytes: number;
  charCount: number;
  chunkCount: number;
  status: DocumentStatus;
  error: string | null;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusBadge({ status }: { status: DocumentStatus }) {
  if (status === "ready") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Check className="size-3" /> Ready
      </Badge>
    );
  }
  if (status === "processing") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="size-3 animate-spin" /> Processing
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <AlertTriangle className="size-3" /> Error
    </Badge>
  );
}

function Dropzone({ onUploaded }: { onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }
    const form = new FormData();
    for (const file of Array.from(files)) {
      form.append("files", file);
    }
    setUploading(true);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as {
        documents?: { status: string }[];
        errors?: string[];
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Upload failed.");
        return;
      }
      const added = data.documents?.length ?? 0;
      const failed = data.documents?.filter((d) => d.status === "error").length ?? 0;
      for (const msg of data.errors ?? []) {
        toast.error(msg);
      }
      if (added > 0) {
        toast.success(
          `${added} document${added === 1 ? "" : "s"} uploaded` +
            (failed ? ` (${failed} failed to parse)` : ""),
        );
      }
      onUploaded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!uploading) {
          void upload(e.dataTransfer.files);
        }
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => void upload(e.target.files)}
      />
      {uploading ? (
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      ) : (
        <Upload className="text-muted-foreground size-6" />
      )}
      <p className="text-sm">
        {uploading ? "Uploading & indexing…" : "Drag files here, or"}{" "}
        {!uploading && (
          <button
            type="button"
            className="text-primary underline underline-offset-2"
            onClick={() => inputRef.current?.click()}
          >
            browse
          </button>
        )}
      </p>
      <p className="text-muted-foreground text-xs">
        PDF, Markdown, and text files (txt, csv, json, yaml…) up to 25 MB.
      </p>
    </div>
  );
}

function UrlIngest({ onIngested }: { onIngested: () => void }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    const trimmed = url.trim();
    if (!trimmed || loading) {
      return;
    }
    setLoading(true);
    try {
      const result = await ingestUrlAction(trimmed);
      if (result.ok) {
        toast.success("Page added to the knowledge base", { description: result.title });
        setUrl("");
        onIngested();
      } else {
        toast.error("Could not ingest URL", { description: result.error });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <LinkIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="https://… — fetch a web page into the knowledge base"
          className="pl-8"
          disabled={loading}
        />
      </div>
      <Button onClick={() => void submit()} disabled={loading || !url.trim()}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : "Add page"}
      </Button>
    </div>
  );
}

function DocumentRow({ doc }: { doc: DocumentView }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(doc.title);

  function run(action: () => Promise<void>) {
    startTransition(async () => {
      await action();
      router.refresh();
    });
  }

  function saveRename() {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    setEditing(false);
    run(() => renameDocumentAction(doc.id, trimmed));
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <FileText className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            {editing ? (
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveRename();
                  if (e.key === "Escape") {
                    setEditing(false);
                    setDraft(doc.title);
                  }
                }}
                className="h-7"
                autoFocus
              />
            ) : (
              <p className="truncate text-sm font-medium">{doc.title}</p>
            )}
            <p className="text-muted-foreground truncate text-xs">{doc.filename}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {editing ? (
            <>
              <Button variant="ghost" size="icon" aria-label="Save" onClick={saveRename}>
                <Check className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Cancel"
                onClick={() => {
                  setEditing(false);
                  setDraft(doc.title);
                }}
              >
                <X className="size-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Rename"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete"
                disabled={isPending}
                onClick={() => run(() => deleteDocumentAction(doc.id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <StatusBadge status={doc.status} />
        <span className="uppercase">{doc.kind}</span>
        <span>{formatBytes(doc.sizeBytes)}</span>
        {doc.status === "ready" ? (
          <span>
            {doc.chunkCount} chunk{doc.chunkCount === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      {doc.status === "error" && doc.error ? (
        <p className="mt-2 text-xs text-red-500 dark:text-red-400">{doc.error}</p>
      ) : null}
    </div>
  );
}

export function DocumentsView({
  documents,
  embeddingsConfigured,
}: {
  documents: DocumentView[];
  embeddingsConfigured: boolean;
}) {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {!embeddingsConfigured ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          No embeddings model set in Settings. Documents are still stored and chunked, but
          semantic retrieval is disabled until you configure an embeddings model — the LLM
          won&apos;t be able to reference them.
        </div>
      ) : null}

      <Dropzone onUploaded={() => router.refresh()} />

      <UrlIngest onIngested={() => router.refresh()} />

      {documents.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-sm">
          No documents yet. Upload files above and the local LLM can reference them in Chat
          and Agents.
        </p>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} />
          ))}
        </div>
      )}
    </div>
  );
}
