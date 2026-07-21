"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Send, Sparkles, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { streamOrJson } from "./stream";

interface ComposerProps {
  threadId: string;
  /** Display name of who the reply goes to (the latest counterparty). */
  replyTo: string;
  onSent: () => void;
}

/** Reply box with an AI-draft button that streams straight into the textarea. */
export function Composer({ threadId, replyTo, onSent }: ComposerProps) {
  const [text, setText] = useState("");
  const [instruction, setInstruction] = useState("");
  const [replyAll, setReplyAll] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);

  const busy = drafting || sending;

  async function handleDraft() {
    if (drafting) return;
    setDrafting(true);
    try {
      await streamOrJson("/api/gmail/draft", { threadId, instruction }, setText);
    } catch (err) {
      toast.error("AI draft failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDrafting(false);
    }
  }

  async function handleSend() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, body, replyAll }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        to?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error("Send failed", { description: data.error });
        return;
      }
      toast.success(`Reply sent to ${data.to ?? replyTo}`);
      setText("");
      setInstruction("");
      onSent();
    } catch {
      toast.error("Send failed", { description: "Could not reach the server." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">
          Replying to {replyAll ? "everyone on" : ""} {replyTo}
        </span>
        <button
          type="button"
          onClick={() => setReplyAll((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 transition-colors",
            replyAll
              ? "border-primary/50 bg-primary/10 text-primary"
              : "hover:bg-muted",
          )}
        >
          <Users className="size-3" />
          Reply all
        </button>
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write a reply — or let the AI draft one…"
        rows={4}
        className="max-h-64 min-h-24 resize-y"
        disabled={sending}
      />

      <div className="flex items-center gap-2">
        <Input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Optional guidance for the AI draft (tone, points to make…)"
          className="h-8 flex-1 text-xs"
          disabled={busy}
        />
        <Button variant="outline" size="sm" onClick={handleDraft} disabled={busy}>
          <Sparkles className="size-3.5" />
          {drafting ? "Drafting…" : "AI draft"}
        </Button>
        <Button size="sm" onClick={handleSend} disabled={busy || !text.trim()}>
          <Send className="size-3.5" />
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
