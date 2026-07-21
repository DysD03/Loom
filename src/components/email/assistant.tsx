"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { ArrowUp, Bot, Check, RotateCcw, Send, Square, X } from "lucide-react";

import { getChatInstance } from "@/lib/chat-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { ToolCallBlock } from "@/components/chat/tool-call-block";
import { ReasoningBlock } from "@/components/chat/reasoning-block";

const SUGGESTIONS = [
  "Summarize my unread emails",
  "Which emails need a reply? Make a plan and draft the replies.",
  "Summarize this thread and draft a reply",
  "Archive newsletters older than a week",
];

interface SendReplyInput {
  threadId?: string;
  body?: string;
  replyAll?: boolean;
}

interface SendReplyOutput {
  sent?: boolean;
  to?: string;
  subject?: string;
  error?: string;
}

/** Mutating tools whose completion should refresh the mailbox UI. */
const MUTATING_TOOLS = new Set(["sendReply", "archiveThread", "markThreadRead"]);

function hasMutatingOutput(message: UIMessage | undefined): boolean {
  return Boolean(
    message?.parts.some(
      (p) =>
        isToolUIPart(p) &&
        MUTATING_TOOLS.has(String(getToolName(p))) &&
        p.state === "output-available",
    ),
  );
}

/**
 * Approval card for a `sendReply` tool call: shows the exact reply the agent
 * wants to send and asks the user to approve or deny it. Uses AI SDK v6 tool
 * approvals — the send executes only after approval, on the resumed run.
 */
function SendApprovalCard({
  part,
  subject,
  onRespond,
}: {
  part: { state: string; input?: unknown; output?: unknown; errorText?: string };
  subject: string | undefined;
  onRespond: (approvalId: string, approved: boolean) => void;
}) {
  const input = (part.input ?? {}) as SendReplyInput;
  const output = (part.output ?? {}) as SendReplyOutput;
  const approval = (part as { approval?: { id: string; approved?: boolean } }).approval;
  const state = String(part.state);

  const header = (label: string, tone: "pending" | "ok" | "bad") => (
    <p
      className={
        "flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase " +
        (tone === "ok"
          ? "text-emerald-400"
          : tone === "bad"
            ? "text-destructive"
            : "text-amber-400")
      }
    >
      <Send className="size-3" />
      {label}
    </p>
  );

  if (state === "approval-requested") {
    return (
      <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
        {header("Approve this reply?", "pending")}
        <div className="text-xs text-muted-foreground">
          {subject ? <p className="truncate">On: {subject}</p> : null}
          <p>
            Thread {input.threadId ?? "?"}
            {input.replyAll ? " · reply all" : ""}
          </p>
        </div>
        <div className="max-h-48 overflow-y-auto rounded-md border bg-background/60 p-2 text-sm whitespace-pre-wrap">
          {input.body ?? "(empty body)"}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => approval && onRespond(approval.id, true)}
            disabled={!approval}
          >
            <Check className="size-3.5" />
            Approve &amp; send
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => approval && onRespond(approval.id, false)}
            disabled={!approval}
          >
            <X className="size-3.5" />
            Deny
          </Button>
        </div>
      </div>
    );
  }

  if (state === "approval-responded") {
    const approved = approval?.approved ?? false;
    return (
      <div className="rounded-lg border p-3">
        {approved
          ? header("Approved — sending…", "pending")
          : header("Denied — not sent", "bad")}
      </div>
    );
  }

  if (state === "output-available") {
    return (
      <div className="space-y-1 rounded-lg border p-3">
        {output.sent
          ? header(`Reply sent to ${output.to ?? "recipient"}`, "ok")
          : header(`Send failed${output.error ? `: ${output.error}` : ""}`, "bad")}
        {output.sent && output.subject ? (
          <p className="truncate text-xs text-muted-foreground">{output.subject}</p>
        ) : null}
      </div>
    );
  }

  if (state === "output-error") {
    return (
      <div className="rounded-lg border p-3">
        {header(`Send failed: ${part.errorText ?? "unknown error"}`, "bad")}
      </div>
    );
  }

  // output-denied / input-streaming / anything new — compact status line.
  return (
    <div className="rounded-lg border p-3">
      {state === "output-denied"
        ? header("Denied — not sent", "bad")
        : header("Preparing reply…", "pending")}
    </div>
  );
}

interface AssistantProps {
  /** Thread currently open in the reading pane (context hint for the agent). */
  contextThreadId: string | null;
  resolveThreadSubject: (threadId: string) => string | undefined;
  /** Called after the agent changed the mailbox (sent/archived/marked). */
  onMailboxChanged: () => void;
  onClose: () => void;
}

/** The plan-then-execute email agent, docked to the right of the mailbox. */
export function Assistant({
  contextThreadId,
  resolveThreadSubject,
  onMailboxChanged,
  onClose,
}: AssistantProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevStatusRef = useRef<string>("ready");

  // Singleton instance so an in-flight plan survives tab switches; approvals
  // auto-resume the run once every pending tool call has a response.
  const chat = useMemo(
    () =>
      getChatInstance({
        id: "email-assistant",
        api: "/api/gmail/assistant",
        body: {},
        initialMessages: [],
        sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      }),
    [],
  );

  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    setMessages,
    addToolApprovalResponse,
  } = useChat({ chat });

  const isStreaming = status === "submitted" || status === "streaming";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  // When a run that mutated the mailbox settles, refresh the list/thread panes.
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev !== "ready" && status === "ready") {
      if (hasMutatingOutput(messages[messages.length - 1])) {
        onMailboxChanged();
      }
    }
  }, [status, messages, onMailboxChanged]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    void sendMessage({ text: trimmed }, { body: { contextThreadId } });
    setInput("");
  }

  function handleRespond(approvalId: string, approved: boolean) {
    void addToolApprovalResponse({
      id: approvalId,
      approved,
      options: { body: { contextThreadId } },
    });
  }

  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l bg-sidebar/30">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="size-4 text-primary" />
          Email assistant
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setMessages([])}
            aria-label="New conversation"
            disabled={isStreaming || messages.length === 0}
          >
            <RotateCcw className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close assistant">
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="space-y-2 pt-6">
            <p className="text-center text-xs text-muted-foreground">
              Ask for a summary, a triage plan, or replies. Sends always need your
              approval.
            </p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className="block w-full rounded-md border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-xs whitespace-pre-wrap text-primary-foreground">
                  {message.parts
                    .filter((p): p is { type: "text"; text: string } => p.type === "text")
                    .map((p) => p.text)
                    .join("")}
                </div>
              </div>
            ) : (
              <div key={message.id} className="space-y-2">
                {message.parts.map((part, i) => {
                  if (part.type === "text") {
                    return part.text.trim() ? <Markdown key={i}>{part.text}</Markdown> : null;
                  }
                  if (part.type === "reasoning") {
                    return part.text.trim() ? (
                      <ReasoningBlock
                        key={i}
                        text={part.text}
                        streaming={part.state === "streaming"}
                      />
                    ) : null;
                  }
                  if (isToolUIPart(part)) {
                    if (String(getToolName(part)) === "sendReply") {
                      const inputThreadId = ((part.input ?? {}) as SendReplyInput).threadId;
                      return (
                        <SendApprovalCard
                          key={i}
                          part={part}
                          subject={
                            inputThreadId ? resolveThreadSubject(inputThreadId) : undefined
                          }
                          onRespond={handleRespond}
                        />
                      );
                    }
                    return <ToolCallBlock key={i} part={part} />;
                  }
                  return null;
                })}
              </div>
            ),
          )
        )}

        {status === "submitted" ? (
          <p className="text-xs text-muted-foreground">Thinking…</p>
        ) : null}
        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error.message || "The assistant run failed."}
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            placeholder="Plan, summarize, reply…"
            rows={1}
            className="max-h-32 min-h-[38px] resize-none text-sm"
          />
          {isStreaming ? (
            <Button size="icon-sm" variant="secondary" onClick={() => stop()} aria-label="Stop">
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              onClick={() => submit(input)}
              disabled={!input.trim()}
              aria-label="Send"
            >
              <ArrowUp className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
