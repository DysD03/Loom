"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  FilePenLine,
  Loader2,
  Play,
  Plus,
  Power,
  Square,
  Wrench,
} from "lucide-react";
import type { Message, Part } from "@opencode-ai/sdk";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { ReasoningBlock } from "@/components/chat/reasoning-block";

interface OpencodeMessage {
  info: Message;
  parts: Part[];
}
interface ServerStatus {
  running: boolean;
  baseUrl: string | null;
  error: string | null;
}

const SEED_KEY = "opencode-seed";

function ToolPartView({ part }: { part: Extract<Part, { type: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const { state, tool } = part;
  const status = state.status;
  const running = status === "running" || status === "pending";
  const error = status === "error";
  const title = "title" in state && state.title ? state.title : tool;

  return (
    <div className="border-border/50 bg-muted/20 rounded-md border text-xs">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {running ? (
          <Loader2 className="text-neon-cyan size-3 shrink-0 animate-spin" />
        ) : error ? (
          <CircleDot className="text-destructive size-3 shrink-0" />
        ) : (
          <Wrench className="text-muted-foreground size-3 shrink-0" />
        )}
        <span className="flex-1 truncate font-medium">{title}</span>
        <span className="text-muted-foreground">{tool}</span>
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      </button>
      {open ? (
        <div className="border-border/50 space-y-2 border-t px-2.5 py-2">
          <pre className="text-muted-foreground overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(state.input, null, 2)}
          </pre>
          {status === "completed" && state.output ? (
            <pre className="overflow-x-auto whitespace-pre-wrap">{state.output.slice(0, 4000)}</pre>
          ) : null}
          {status === "error" ? (
            <pre className="text-destructive whitespace-pre-wrap">{state.error}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PartView({ part }: { part: Part }) {
  if (part.type === "text") {
    return part.text.trim() ? <Markdown>{part.text}</Markdown> : null;
  }
  if (part.type === "reasoning") {
    return part.text.trim() ? <ReasoningBlock text={part.text} /> : null;
  }
  if (part.type === "tool") {
    return <ToolPartView part={part} />;
  }
  if (part.type === "patch") {
    return (
      <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
        <FilePenLine className="text-neon-green size-3" />
        {part.files.map((f) => (
          <span key={f} className="bg-muted/40 rounded px-1.5 py-0.5 font-mono">
            {f}
          </span>
        ))}
      </div>
    );
  }
  return null;
}

function MessageView({ message }: { message: OpencodeMessage }) {
  const isUser = message.info.role === "user";
  if (isUser) {
    const text = message.parts
      .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("");
    return (
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground max-w-[80%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
          {text}
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-[90%] space-y-2">
      {message.parts.map((part, i) => (
        <PartView key={part.id ?? i} part={part} />
      ))}
    </div>
  );
}

export function OpencodeView({
  workspaceId,
  title,
  path,
}: {
  workspaceId: string;
  title: string;
  path: string;
}) {
  const [status, setStatus] = useState<ServerStatus>({ running: false, baseUrl: null, error: null });
  const [starting, setStarting] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<OpencodeMessage[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadMessages = useCallback(
    async (sid: string) => {
      try {
        const res = await fetch(
          `/api/opencode/messages?workspaceId=${workspaceId}&sessionId=${sid}`,
        );
        const data = await res.json();
        if (res.ok && Array.isArray(data.messages)) setMessages(data.messages);
      } catch {
        // transient during polling; ignore
      }
    },
    [workspaceId],
  );

  // Start the server, load the latest session, and honor a queued seed task.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStarting(true);
      try {
        const res = await fetch("/api/opencode/status", { method: "POST" });
        const st: ServerStatus = await res.json();
        if (cancelled) return;
        setStatus(st);
        if (st.running) {
          const sres = await fetch(`/api/opencode/sessions?workspaceId=${workspaceId}`);
          const sdata = await sres.json();
          const sessions: { id: string; time?: { updated?: number } }[] = sdata.sessions ?? [];
          if (!cancelled && sessions.length > 0) {
            const latest = [...sessions].sort(
              (a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0),
            )[0];
            setSessionId(latest.id);
            await loadMessages(latest.id);
          }
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
      const seed = sessionStorage.getItem(SEED_KEY);
      if (seed && !cancelled) {
        setInput(seed);
        sessionStorage.removeItem(SEED_KEY);
      }
    })();
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [workspaceId, loadMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function toggleServer(start: boolean) {
    const res = await fetch("/api/opencode/status", { method: start ? "POST" : "DELETE" });
    setStatus(await res.json());
  }

  async function run() {
    const text = input.trim();
    if (!text || running) return;
    setRunning(true);
    setInput("");

    try {
      let sid = sessionId;
      if (!sid) {
        const cres = await fetch("/api/opencode/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, title: text.slice(0, 50) }),
        });
        const cdata = await cres.json();
        if (!cres.ok || !cdata.session?.id) throw new Error(cdata.error ?? "Couldn’t start a session.");
        sid = cdata.session.id as string;
        setSessionId(sid);
      }

      // Show the user's message immediately, then poll opencode while it works.
      pollRef.current = setInterval(() => sid && loadMessages(sid), 1500);

      const res = await fetch("/api/opencode/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, sessionId: sid, text }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "The run failed.");
      await loadMessages(sid);
    } catch (err) {
      toast.error("OpenCode run failed", {
        description: err instanceof Error ? err.message : "Check the server and that a model is configured.",
      });
    } finally {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setRunning(false);
    }
  }

  function newSession() {
    setSessionId(null);
    setMessages([]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      run();
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-6">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{title}</h1>
          <p className="text-muted-foreground truncate text-[11px]">{path}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex items-center gap-1.5 rounded px-2 py-1 text-[11px]",
              status.running ? "text-neon-green" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                status.running ? "bg-neon-green animate-pulse" : "bg-muted-foreground/50",
              )}
            />
            {starting ? "Starting…" : status.running ? "Server running" : "Stopped"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleServer(!status.running)}
            disabled={starting}
          >
            <Power className="size-4" />
            {status.running ? "Stop" : "Start"}
          </Button>
          <Button variant="outline" size="sm" onClick={newSession} disabled={running}>
            <Plus className="size-4" /> New session
          </Button>
        </div>
      </header>

      {status.error ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive border-b px-6 py-2.5 text-xs">
          {status.error}
        </div>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-6">
          {messages.length === 0 ? (
            <div className="text-muted-foreground py-16 text-center text-sm">
              {status.running
                ? "Describe a task and OpenCode will build it in this folder."
                : "Start the server to run coding tasks in this folder."}
            </div>
          ) : (
            messages.map((m) => <MessageView key={m.info.id} message={m} />)
          )}
          {running ? (
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <Loader2 className="size-3.5 animate-spin" /> OpenCode is working…
            </div>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe a task to run in this project…  (⌘/Ctrl+Enter to run)"
            rows={2}
            disabled={running}
            className="max-h-48 min-h-[52px] resize-none"
          />
          {running ? (
            <Button size="icon" variant="secondary" disabled aria-label="Running">
              <Square className="size-4" />
            </Button>
          ) : (
            <Button size="icon" onClick={run} disabled={!input.trim()} aria-label="Run">
              <Play className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
