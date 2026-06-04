"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { toast } from "sonner";
import {
  ArrowUp,
  Check,
  ListChecks,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  Square,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { getChatInstance } from "@/lib/chat-store";
import {
  assistEditorAction,
  reindexEditorDocAction,
  saveEditorDocAction,
  type AssistAction,
} from "@/app/editor/actions";

const AUTOSAVE_MS = 1_000;
const REINDEX_MS = 4_000;

const VERIFY_PROMPT =
  "Verify the use cases described in this document. Identify gaps, contradictions, " +
  "missing or edge cases, ambiguous requirements, and unstated assumptions. " +
  "List concrete, actionable findings grouped by severity.";

const ASSIST_BUTTONS: { action: AssistAction; label: string }[] = [
  { action: "rewrite", label: "Rewrite" },
  { action: "expand", label: "Expand" },
  { action: "shorten", label: "Shorten" },
  { action: "fix", label: "Fix grammar" },
];

interface EditorDoc {
  id: string;
  title: string;
  content: string;
  indexed: boolean;
}

type SaveState = "idle" | "saving" | "saved";
type IndexState = "idle" | "indexing" | "indexed" | "error";

export function EditorView({
  doc,
  embeddingsConfigured,
}: {
  doc: EditorDoc;
  embeddingsConfigured: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(doc.title);
  const [content, setContent] = useState(doc.content);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [indexState, setIndexState] = useState<IndexState>(
    doc.indexed ? "indexed" : "idle",
  );
  const [assisting, setAssisting] = useState<AssistAction | null>(null);
  const [showPanel, setShowPanel] = useState(true);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const firstSave = useRef(true);
  const firstIndex = useRef(true);

  // Single debounced autosave: persist + refresh the sidebar title. The effect
  // re-runs on every change, so the timeout closure always has the latest text.
  // The view owns its local state, so the refresh doesn't clobber typing.
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    setSaveState("saving");
    const t = setTimeout(async () => {
      await saveEditorDocAction(doc.id, title, content);
      setSaveState("saved");
      router.refresh();
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [title, content, doc.id, router]);

  // Auto-index into the RAG knowledge base once editing settles.
  useEffect(() => {
    if (firstIndex.current) {
      firstIndex.current = false;
      return;
    }
    setIndexState("indexing");
    const t = setTimeout(async () => {
      await saveEditorDocAction(doc.id, title, content);
      const res = await reindexEditorDocAction(doc.id);
      setIndexState("error" in res ? "error" : "indexed");
    }, REINDEX_MS);
    return () => clearTimeout(t);
  }, [title, content, doc.id]);

  async function runAssist(action: AssistAction) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const hasSelection = end > start;
    const target = hasSelection ? content.slice(start, end) : content;
    if (!target.trim()) {
      toast.error("Write or select some text first.");
      return;
    }
    setAssisting(action);
    try {
      const res = await assistEditorAction(action, target, content);
      if ("error" in res) {
        toast.error("Assist failed", { description: res.error });
        return;
      }
      const next = hasSelection
        ? content.slice(0, start) + res.text + content.slice(end)
        : res.text;
      setContent(next);
    } catch {
      toast.error("Assist failed", {
        description: "Check the model connection in Settings.",
      });
    } finally {
      setAssisting(null);
    }
  }

  async function flushSave() {
    await saveEditorDocAction(doc.id, title, content);
  }

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled document"
            className="h-9 max-w-md border-none bg-transparent text-base font-semibold shadow-none focus-visible:ring-0"
          />
          <SaveIndicator save={saveState} index={indexState} />
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            aria-label={showPanel ? "Hide assistant" : "Show assistant"}
            onClick={() => setShowPanel((v) => !v)}
          >
            {showPanel ? (
              <PanelRightClose className="size-4" />
            ) : (
              <PanelRightOpen className="size-4" />
            )}
          </Button>
        </header>

        <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
          <Sparkles className="text-muted-foreground mr-1 size-3.5" />
          {ASSIST_BUTTONS.map((b) => (
            <Button
              key={b.action}
              variant="outline"
              size="sm"
              disabled={assisting !== null}
              onClick={() => runAssist(b.action)}
            >
              {assisting === b.action ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              {b.label}
            </Button>
          ))}
          <span className="text-muted-foreground ml-1 text-xs">
            acts on selection, or the whole document
          </span>
        </div>

        <div className="flex min-h-0 flex-1">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write Markdown here…"
            spellCheck
            className="placeholder:text-muted-foreground min-h-0 flex-1 resize-none overflow-y-auto border-r bg-transparent p-5 font-mono text-sm leading-relaxed outline-none"
          />
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {content.trim() ? (
              <Markdown>{content}</Markdown>
            ) : (
              <p className="text-muted-foreground text-sm">Preview appears here.</p>
            )}
          </div>
        </div>
      </div>

      {showPanel ? (
        <DocChat
          docId={doc.id}
          embeddingsConfigured={embeddingsConfigured}
          onBeforeSend={flushSave}
        />
      ) : null}
    </div>
  );
}

function SaveIndicator({ save, index }: { save: SaveState; index: IndexState }) {
  return (
    <div className="text-muted-foreground flex items-center gap-3 text-xs">
      {save === "saving" ? (
        <span className="flex items-center gap-1">
          <Loader2 className="size-3 animate-spin" /> Saving
        </span>
      ) : save === "saved" ? (
        <span className="flex items-center gap-1">
          <Check className="size-3" /> Saved
        </span>
      ) : null}
      {index === "indexing" ? (
        <span className="flex items-center gap-1">
          <Loader2 className="size-3 animate-spin" /> Indexing
        </span>
      ) : index === "indexed" ? (
        <span className="flex items-center gap-1 text-emerald-500">
          <Check className="size-3" /> In knowledge base
        </span>
      ) : index === "error" ? (
        <span className="text-amber-500">Index failed</span>
      ) : null}
    </div>
  );
}

function chatText(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function DocChat({
  docId,
  embeddingsConfigured,
  onBeforeSend,
}: {
  docId: string;
  embeddingsConfigured: boolean;
  onBeforeSend: () => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = useMemo(
    () =>
      getChatInstance({
        id: `editor:${docId}`,
        api: "/api/editor/chat",
        body: { documentId: docId },
        initialMessages: [],
      }),
    [docId],
  );
  const { messages, sendMessage, status, stop, error } = useChat({ chat });
  const isStreaming = status === "submitted" || status === "streaming";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    await onBeforeSend(); // make sure the model sees the latest document text
    sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <div className="bg-sidebar/30 flex h-full w-80 shrink-0 flex-col border-l xl:w-96">
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4">
        <span className="text-sm font-semibold">Assistant</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void send(VERIFY_PROMPT)}
          disabled={isStreaming}
        >
          <ListChecks className="size-4" />
          Verify use cases
        </Button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <p className="text-muted-foreground px-1 py-6 text-center text-xs">
            Ask about this document, or click <strong>Verify use cases</strong> to review it.
          </p>
        ) : (
          messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap">
                  {chatText(m)}
                </div>
              </div>
            ) : (
              <div key={m.id} className="max-w-full">
                <Markdown>{chatText(m)}</Markdown>
              </div>
            ),
          )
        )}
        {status === "submitted" ? (
          <div className="text-muted-foreground text-sm">Thinking…</div>
        ) : null}
        {error ? (
          <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
            {error.message || "Something went wrong contacting the model."}
          </div>
        ) : null}
      </div>

      {!embeddingsConfigured ? (
        <p className="text-muted-foreground border-t px-3 py-1.5 text-[11px]">
          No embeddings model set — this document won&apos;t be searchable in Chat/Agents.
        </p>
      ) : null}

      <div className="shrink-0 border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="Ask about this document…"
            rows={1}
            className="max-h-32 min-h-[40px] resize-none"
          />
          {isStreaming ? (
            <Button size="icon" variant="secondary" onClick={() => stop()} aria-label="Stop">
              <Square className="size-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={() => void send(input)}
              disabled={!input.trim()}
              aria-label="Send"
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
