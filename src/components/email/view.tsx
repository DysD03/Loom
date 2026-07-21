"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Inbox, RefreshCw, Search, Sparkles, Unplug } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  EMAIL_VIEWS,
  type EmailViewKey,
  type GmailStatus,
  type ThreadSummary,
} from "@/lib/gmail/types";
import { disconnectGmailAction } from "@/app/email/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/markdown";
import { Connect } from "./connect";
import { Thread } from "./thread";
import { Assistant } from "./assistant";
import { streamOrJson } from "./stream";

interface EmailViewProps {
  status: GmailStatus;
  clientId: string;
  secretSet: boolean;
  oauthError: string | null;
  justConnected: boolean;
}

interface ThreadsResponse {
  threads: ThreadSummary[];
  nextPageToken: string | null;
  error?: string;
  code?: string;
}

function listDate(ms: number): string {
  if (!ms) return "";
  const date = new Date(ms);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

/** The whole Email tab: list + reading pane + assistant, or the connect card. */
export function EmailView({
  status,
  clientId,
  secretSet,
  oauthError,
  justConnected,
}: EmailViewProps) {
  const router = useRouter();

  const [view, setView] = useState<EmailViewKey>("inbox");
  const [searchInput, setSearchInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [authLost, setAuthLost] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [digest, setDigest] = useState<{ text: string; streaming: boolean } | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const connectToastShown = useRef(false);

  // One-time "connected" toast after the OAuth round-trip, then clean the URL.
  useEffect(() => {
    if (!connectToastShown.current && justConnected && status.connected) {
      connectToastShown.current = true;
      toast.success(`Gmail connected: ${status.email}`);
      router.replace("/email");
    }
  }, [justConnected, status.connected, status.email, router]);

  const fetchThreads = useCallback(
    async (options: { pageToken?: string; silent?: boolean } = {}) => {
      const { pageToken, silent } = options;
      if (pageToken) setLoadingMore(true);
      else if (!silent) setLoadingList(true);
      setListError(null);
      try {
        const params = new URLSearchParams({ view });
        if (activeQuery.trim()) params.set("q", activeQuery.trim());
        if (pageToken) params.set("pageToken", pageToken);
        const res = await fetch(`/api/gmail/threads?${params.toString()}`);
        const data = (await res.json()) as ThreadsResponse;
        if (res.status === 401) {
          setAuthLost(data.error ?? "Gmail connection lost — reconnect.");
          return;
        }
        if (!res.ok) {
          setListError(data.error ?? `Loading threads failed (${res.status}).`);
          return;
        }
        setThreads((prev) => (pageToken ? [...prev, ...data.threads] : data.threads));
        setNextPageToken(data.nextPageToken);
      } catch {
        setListError("Could not reach the server.");
      } finally {
        setLoadingList(false);
        setLoadingMore(false);
      }
    },
    [view, activeQuery],
  );

  useEffect(() => {
    if (!status.connected) return;
    // Microtask hop keeps the effect body free of synchronous state updates.
    void Promise.resolve().then(() => fetchThreads());
  }, [status.connected, fetchThreads]);

  const handleMailboxChanged = useCallback(() => {
    void fetchThreads({ silent: true });
    setReloadToken((t) => t + 1);
  }, [fetchThreads]);

  if (!status.connected || authLost) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-14 shrink-0 items-center border-b px-6">
          <h1 className="text-base font-semibold">Email</h1>
        </header>
        <Connect
          clientId={clientId}
          secretSet={secretSet}
          oauthError={authLost ?? oauthError}
        />
      </div>
    );
  }

  async function handleDisconnect() {
    if (disconnecting) return;
    if (!window.confirm(`Disconnect ${status.email}? Tokens are removed from the local DB.`)) {
      return;
    }
    setDisconnecting(true);
    try {
      await disconnectGmailAction();
      router.refresh();
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleDigest() {
    setSelectedId(null);
    setDigest({ text: "", streaming: true });
    try {
      const result = await streamOrJson("/api/gmail/summarize", { digest: true }, (acc) =>
        setDigest({ text: acc, streaming: true }),
      );
      setDigest({ text: result.text, streaming: false });
    } catch (err) {
      setDigest(null);
      toast.error("Digest failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  function selectThread(id: string) {
    setDigest(null);
    setSelectedId(id);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-6">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="text-base font-semibold">Email</h1>
          <span className="truncate rounded-md border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
            {status.email}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant={assistantOpen ? "secondary" : "outline"}
            size="sm"
            onClick={() => setAssistantOpen((v) => !v)}
          >
            <Bot className="size-4" />
            Assistant
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleDisconnect}
            disabled={disconnecting}
            aria-label="Disconnect Gmail"
          >
            <Unplug className="size-3.5" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Thread list */}
        <div className="flex w-[360px] shrink-0 flex-col border-r">
          <div className="shrink-0 space-y-2 border-b p-3">
            <div className="flex items-center gap-1">
              {EMAIL_VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setView(v.key)}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs transition-colors",
                    view === v.key
                      ? "bg-primary/15 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {v.label}
                </button>
              ))}
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleDigest}
                aria-label="Summarize unread (digest)"
                title="Summarize unread email"
              >
                <Sparkles className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => fetchThreads()}
                aria-label="Refresh"
              >
                <RefreshCw className={cn("size-3.5", loadingList && "animate-spin")} />
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setActiveQuery(searchInput);
                }}
                placeholder="Search mail (from:, is:unread, …)"
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {listError ? (
              <div className="m-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {listError}
                <Button
                  variant="outline"
                  size="xs"
                  className="mt-2"
                  onClick={() => fetchThreads()}
                >
                  Retry
                </Button>
              </div>
            ) : loadingList && threads.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                Loading…
              </div>
            ) : threads.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-xs text-muted-foreground">
                <Inbox className="size-5" />
                No threads here.
              </div>
            ) : (
              <>
                {threads.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => selectThread(t.id)}
                    className={cn(
                      "block w-full border-b px-4 py-3 text-left transition-colors",
                      selectedId === t.id ? "bg-muted" : "hover:bg-muted/50",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {t.unread ? (
                        <span className="size-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_6px_var(--neon-cyan)]" />
                      ) : null}
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-xs",
                          t.unread ? "font-semibold" : "text-muted-foreground",
                        )}
                      >
                        {t.from.name || t.from.email || "(unknown sender)"}
                        {t.messageCount > 1 ? ` · ${t.messageCount}` : ""}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {listDate(t.date)}
                      </span>
                    </div>
                    <p
                      className={cn(
                        "mt-0.5 truncate text-sm",
                        t.unread ? "font-medium" : "",
                      )}
                    >
                      {t.subject}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{t.snippet}</p>
                  </button>
                ))}
                {nextPageToken ? (
                  <div className="p-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={loadingMore}
                      onClick={() => fetchThreads({ pageToken: nextPageToken })}
                    >
                      {loadingMore ? "Loading…" : "Load more"}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* Reading pane */}
        <div className="flex min-w-0 flex-1 flex-col">
          {digest ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <div className="mx-auto max-w-2xl rounded-lg border border-primary/30 bg-primary/5 p-5">
                <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-primary uppercase">
                  <Sparkles className="size-3" />
                  Unread digest
                  {digest.streaming ? (
                    <span className="ml-1 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                  ) : null}
                </p>
                {digest.text ? (
                  <Markdown>{digest.text}</Markdown>
                ) : (
                  <p className="text-sm text-muted-foreground">Reading unread email…</p>
                )}
              </div>
            </div>
          ) : selectedId ? (
            <Thread
              key={`${selectedId}:${reloadToken}`}
              threadId={selectedId}
              selfEmail={status.email}
              onThreadRead={(id) =>
                setThreads((prev) =>
                  prev.map((t) => (t.id === id ? { ...t, unread: false } : t)),
                )
              }
              onThreadUnread={(id) =>
                setThreads((prev) =>
                  prev.map((t) => (t.id === id ? { ...t, unread: true } : t)),
                )
              }
              onArchived={(id) => {
                setThreads((prev) => prev.filter((t) => t.id !== id));
                setSelectedId(null);
              }}
              onReplied={() => void fetchThreads({ silent: true })}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Inbox className="size-6" />
              Select a thread — or hit <Sparkles className="inline size-3.5" /> for an
              unread digest.
            </div>
          )}
        </div>

        {assistantOpen ? (
          <Assistant
            contextThreadId={selectedId}
            resolveThreadSubject={(id) => threads.find((t) => t.id === id)?.subject}
            onMailboxChanged={handleMailboxChanged}
            onClose={() => setAssistantOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}
