"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { isToolUIPart, type UIMessage } from "ai";

import { getChatInstance } from "@/lib/chat-store";
import { toast } from "sonner";
import { ArrowUp, Brain, Square, TriangleAlert, Workflow } from "lucide-react";

import type { ConversationType } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { CopyButton } from "@/components/copy-button";
import { ModelSelect } from "@/components/chat/model-select";
import { extractMemoriesAction } from "@/app/memory/actions";
import { sendToCanvasAction } from "@/app/canvas/actions";
import { SendToOpencodeButton } from "@/components/opencode/send-button";
import { ToolCallBlock } from "@/components/chat/tool-call-block";
import { ReasoningBlock } from "@/components/chat/reasoning-block";

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function countSteps(message: UIMessage): number {
  return message.parts.filter((p) => p.type === "step-start").length;
}

function StepDivider({ step, maxSteps }: { step: number; maxSteps?: number }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
      <span className="h-px flex-1 bg-border/60" />
      <span>Step {maxSteps ? `${step} / ${maxSteps}` : step}</span>
      <span className="h-px flex-1 bg-border/60" />
    </div>
  );
}

function MessageBubble({ message, maxSteps }: { message: UIMessage; maxSteps?: number }) {
  const isUser = message.role === "user";
  const text = messageText(message);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">
          {text}
        </div>
      </div>
    );
  }

  // Show step dividers only on multi-step (tool-using) runs to keep plain chat clean.
  const showSteps = message.parts.some(isToolUIPart);
  const hasText = text.trim().length > 0;

  return (
    <div className="flex justify-start">
      <div className="group max-w-[85%] space-y-2">
        {message.parts.map((part, i) => {
          if (part.type === "step-start") {
            if (!showSteps) return null;
            // Step number = count of step-start parts up to and including this one.
            const step = message.parts
              .slice(0, i + 1)
              .filter((p) => p.type === "step-start").length;
            return step > 1 ? <StepDivider key={i} step={step} maxSteps={maxSteps} /> : null;
          }
          if (part.type === "reasoning") {
            return part.text.trim() ? (
              <ReasoningBlock key={i} text={part.text} streaming={part.state === "streaming"} />
            ) : null;
          }
          if (part.type === "text") {
            return part.text.trim() ? <Markdown key={i}>{part.text}</Markdown> : null;
          }
          if (isToolUIPart(part)) {
            return <ToolCallBlock key={i} part={part} />;
          }
          return null;
        })}
        {hasText ? (
          <div className="opacity-0 transition-opacity group-hover:opacity-100">
            <CopyButton value={text} label="Copy" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface ChatViewProps {
  conversationId: string;
  title: string;
  model: string | null;
  initialMessages: UIMessage[];
  /** Streaming endpoint to post to. Defaults to the plain chat route. */
  api?: string;
  /** Conversation type — drives model-override persistence + revalidation. */
  type?: ConversationType;
  /** Shown as a banner when the configured model can't use tools (agent degrade). */
  toolWarning?: string | null;
  /** Placeholder text for the composer. */
  placeholder?: string;
  /** Agent step cap, surfaced in the step tracker. */
  maxSteps?: number;
  /** Extra controls rendered in the header (e.g. agent settings). */
  headerActions?: React.ReactNode;
}

export function ChatView({
  conversationId,
  title,
  model,
  initialMessages,
  api = "/api/chat",
  type = "chat",
  toolWarning = null,
  placeholder = "Message your local model…  (Enter to send, Shift+Enter for newline)",
  maxSteps,
  headerActions,
}: ChatViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Prefill the composer when launched from a memory suggestion (?seed=…).
  const [input, setInput] = useState(() => searchParams.get("seed") ?? "");
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A persistent Chat instance keyed by conversation id keeps the stream alive
  // across tab switches (which unmount this view) — see lib/chat-store.ts.
  const chat = useMemo(
    () =>
      getChatInstance({
        id: conversationId,
        api,
        body: { conversationId },
        initialMessages,
      }),
    [conversationId, api, initialMessages],
  );

  const { messages, sendMessage, status, stop, error } = useChat({ chat });

  const isStreaming = status === "submitted" || status === "streaming";

  // Refresh server data (sidebar order, derived title) once a stream finishes.
  // The Chat instance owns onFinish, so we watch the status transition here
  // instead — this also fires correctly after returning from another tab.
  const prevStatus = useRef(status);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    if ((was === "streaming" || was === "submitted") && status === "ready") {
      router.refresh();
    }
  }, [status, router]);

  // Live step counter for the currently streaming assistant message.
  const liveStep = useMemo(() => {
    if (status !== "streaming") return 0;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return 0;
    return last.parts.some(isToolUIPart) ? countSteps(last) : 0;
  }, [messages, status]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  function submit() {
    const text = input.trim();
    if (!text || isStreaming) {
      return;
    }
    sendMessage({ text });
    setInput("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  async function handleSendToCanvas() {
    if (isSeeding) return;
    setIsSeeding(true);
    const toastId = toast.loading("Building a canvas from this session…");
    try {
      const result = await sendToCanvasAction(conversationId, "conversation");
      if ("error" in result) {
        toast.error("Send to Canvas failed", { id: toastId, description: result.error });
        return;
      }
      toast.success("Canvas created", { id: toastId });
      router.push(`/canvas?c=${result.canvasId}`);
    } catch {
      toast.error("Send to Canvas failed", {
        id: toastId,
        description: "Check the model connection in Settings.",
      });
    } finally {
      setIsSeeding(false);
    }
  }

  async function handleExtract() {
    setIsExtracting(true);
    try {
      const { added, skipped } = await extractMemoriesAction(conversationId);
      if (added === 0 && skipped === 0) {
        toast.info("No durable memories found in this conversation.");
      } else {
        toast.success(`Saved ${added} ${added === 1 ? "memory" : "memories"}`, {
          description: skipped > 0 ? `${skipped} skipped as duplicates.` : undefined,
        });
      }
    } catch {
      toast.error("Memory extraction failed", {
        description: "Check the model connection in Settings.",
      });
    } finally {
      setIsExtracting(false);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-6">
        <h1 className="truncate text-base font-semibold">{title}</h1>
        <div className="flex items-center gap-2">
          {headerActions}
          <ModelSelect conversationId={conversationId} current={model} type={type} />
          <Button variant="outline" size="sm" onClick={handleExtract} disabled={isExtracting}>
            <Brain className="size-4" />
            {isExtracting ? "Extracting…" : "Extract memories"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendToCanvas}
            disabled={isSeeding || messages.length === 0}
          >
            <Workflow className="size-4" />
            {isSeeding ? "Building…" : "Send to Canvas"}
          </Button>
          <SendToOpencodeButton
            sourceId={conversationId}
            kind="conversation"
            disabled={messages.length === 0}
          />
        </div>
      </header>

      {toolWarning ? (
        <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2.5 text-xs text-amber-600 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <p>{toolWarning}</p>
        </div>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-6">
          {messages.length === 0 ? (
            <div className="py-20 text-center text-sm text-muted-foreground">
              Send a message to start the conversation.
            </div>
          ) : (
            messages.map((message) => (
              <MessageBubble key={message.id} message={message} maxSteps={maxSteps} />
            ))
          )}
          {status === "submitted" ? (
            <div className="text-sm text-muted-foreground">Thinking…</div>
          ) : null}
          {status === "streaming" && liveStep > 0 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              Working… step {maxSteps ? `${liveStep} of ${maxSteps}` : liveStep}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error.message || "Something went wrong contacting the model."}
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
            placeholder={placeholder}
            rows={1}
            className="max-h-48 min-h-[44px] resize-none"
          />
          {isStreaming ? (
            <Button size="icon" variant="secondary" onClick={() => stop()} aria-label="Stop">
              <Square className="size-4" />
            </Button>
          ) : (
            <Button size="icon" onClick={submit} disabled={!input.trim()} aria-label="Send">
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
