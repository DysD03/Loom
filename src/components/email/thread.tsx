"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Archive, MailOpen, RefreshCw, Sparkles } from "lucide-react";

import type { EmailMessage, ThreadDetail } from "@/lib/gmail/types";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { Message } from "./message";
import { Composer } from "./composer";
import { streamOrJson } from "./stream";

interface ThreadProps {
  threadId: string;
  selfEmail: string;
  /** List-sync callbacks so the sidebar reflects reads/archives/replies. */
  onThreadRead: (id: string) => void;
  onThreadUnread: (id: string) => void;
  onArchived: (id: string) => void;
  onReplied: () => void;
}

interface ThreadResponse extends ThreadDetail {
  cachedSummary: string | null;
}

function latestCounterparty(messages: EmailMessage[], self: string): string {
  const other = [...messages]
    .reverse()
    .find((m) => m.from.email.toLowerCase() !== self.toLowerCase());
  const target = other ?? messages[messages.length - 1];
  if (!target) return "thread";
  return target.from.name || target.from.email;
}

/** The open thread: summary card, messages, actions, and the reply composer. */
export function Thread({
  threadId,
  selfEmail,
  onThreadRead,
  onThreadUnread,
  onArchived,
  onReplied,
}: ThreadProps) {
  const [detail, setDetail] = useState<ThreadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ text: string; cached: boolean } | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The parent passes inline callbacks; go through a ref so `load` stays
  // stable and the effect below only refires when the thread id changes.
  const onThreadReadRef = useRef(onThreadRead);
  useEffect(() => {
    onThreadReadRef.current = onThreadRead;
  });

  const load = useCallback(async (id: string, silent = false) => {
    if (!silent) {
      setLoading(true);
      setSummary(null);
    }
    setError(null);
    try {
      const res = await fetch(`/api/gmail/thread?id=${encodeURIComponent(id)}`);
      const data = (await res.json()) as ThreadResponse & { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Failed to load the thread (${res.status}).`);
        return;
      }
      setDetail(data);
      if (data.cachedSummary) {
        setSummary({ text: data.cachedSummary, cached: true });
      }
      // Opening a thread marks it read, like any mail client.
      if (data.messages.some((m) => m.unread)) {
        fetch("/api/gmail/modify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId: id, action: "read" }),
        }).catch(() => undefined);
        onThreadReadRef.current(id);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Microtask hop keeps the effect body free of synchronous state updates.
    void Promise.resolve().then(() => load(threadId));
  }, [threadId, load]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [detail?.id, detail?.messages.length]);

  async function handleSummarize(force = false) {
    if (summarizing) return;
    setSummarizing(true);
    if (force) setSummary(null);
    try {
      const result = await streamOrJson(
        "/api/gmail/summarize",
        { threadId, force },
        (acc) => setSummary({ text: acc, cached: false }),
      );
      setSummary({ text: result.text, cached: result.cached });
    } catch (err) {
      toast.error("Summarize failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSummarizing(false);
    }
  }

  async function handleArchive() {
    if (archiving) return;
    setArchiving(true);
    try {
      const res = await fetch("/api/gmail/modify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, action: "archive" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error("Archive failed", { description: data.error });
        return;
      }
      toast.success("Thread archived");
      onArchived(threadId);
    } finally {
      setArchiving(false);
    }
  }

  async function handleMarkUnread() {
    const res = await fetch("/api/gmail/modify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, action: "unread" }),
    });
    if (res.ok) {
      toast.success("Marked unread");
      onThreadUnread(threadId);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <span className="mr-2 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        Loading thread…
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error ?? "Thread not found."}
        </div>
      </div>
    );
  }

  const replyTo = latestCounterparty(detail.messages, selfEmail);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3">
        <h2 className="min-w-0 truncate text-sm font-semibold">{detail.subject}</h2>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSummarize(false)}
            disabled={summarizing}
          >
            <Sparkles className="size-3.5" />
            {summarizing ? "Summarizing…" : "Summarize"}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={handleMarkUnread} aria-label="Mark unread">
            <MailOpen className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleArchive}
            disabled={archiving}
            aria-label="Archive"
          >
            <Archive className="size-3.5" />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        {summary ? (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-primary uppercase">
                <Sparkles className="size-3" />
                Summary
              </p>
              <div className="flex items-center gap-2">
                {summary.cached ? (
                  <span className="text-[10px] text-muted-foreground uppercase">cached</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => handleSummarize(true)}
                  disabled={summarizing}
                  aria-label="Re-summarize"
                  className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <RefreshCw className="size-3" />
                </button>
              </div>
            </div>
            <Markdown>{summary.text}</Markdown>
          </div>
        ) : null}

        {detail.messages.map((message, i) => (
          <Message
            key={message.id}
            message={message}
            defaultOpen={i === detail.messages.length - 1 || detail.messages.length === 1}
          />
        ))}
      </div>

      <div className="shrink-0 border-t p-4">
        <Composer
          threadId={threadId}
          replyTo={replyTo}
          onSent={() => {
            void load(threadId, true);
            onReplied();
          }}
        />
      </div>
    </div>
  );
}
