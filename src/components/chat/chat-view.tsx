"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { toast } from "sonner";
import { ArrowUp, Brain, Square, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { CopyButton } from "@/components/copy-button";
import { ModelSelect } from "@/components/chat/model-select";
import { extractMemoriesAction } from "@/app/memory/actions";

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = messageText(message);

  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          isUser
            ? "max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground"
            : "group max-w-[85%] space-y-1"
        }
      >
        {isUser ? (
          text
        ) : (
          <>
            <Markdown>{text}</Markdown>
            {text ? (
              <div className="opacity-0 transition-opacity group-hover:opacity-100">
                <CopyButton value={text} label="Copy" />
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

interface ChatViewProps {
  conversationId: string;
  title: string;
  model: string | null;
  initialMessages: UIMessage[];
}

export function ChatView({ conversationId, title, model, initialMessages }: ChatViewProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat", body: { conversationId } }),
    [conversationId],
  );

  const { messages, sendMessage, status, stop, error } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
    onFinish: () => router.refresh(),
  });

  const isStreaming = status === "submitted" || status === "streaming";

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
          <ModelSelect conversationId={conversationId} current={model} />
          <Button
            variant="outline"
            size="sm"
            onClick={handleExtract}
            disabled={isExtracting}
          >
            <Brain className="size-4" />
            {isExtracting ? "Extracting…" : "Extract memories"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              toast.info("Send to Canvas", {
                description: "Canvas seeding arrives in Phase 7.",
              })
            }
          >
            <Workflow className="size-4" />
            Send to Canvas
          </Button>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-6">
          {messages.length === 0 ? (
            <div className="py-20 text-center text-sm text-muted-foreground">
              Send a message to start the conversation.
            </div>
          ) : (
            messages.map((message) => <MessageBubble key={message.id} message={message} />)
          )}
          {status === "submitted" ? (
            <div className="text-sm text-muted-foreground">Thinking…</div>
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
            placeholder="Message your local model…  (Enter to send, Shift+Enter for newline)"
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
