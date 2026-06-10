"use client";

import { useEffect, useMemo, useState } from "react";
import type { UIMessage } from "ai";

/**
 * Rough token estimate (~4 chars/token) for the whole conversation, including a
 * small per-message overhead for role/formatting. It's an approximation — the
 * real tokenizer lives in the model — but good enough to gauge context pressure.
 */
function estimateTokens(messages: UIMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "text" || part.type === "reasoning") {
        chars += part.text.length;
      } else if (part.type !== "step-start") {
        chars += JSON.stringify(part).length;
      }
    }
    chars += 16;
  }
  return Math.ceil(chars / 4);
}

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

/**
 * A live context-window usage meter for the chat header: estimated tokens used by
 * the current conversation vs. the loaded model's context length. Hides itself
 * when the context length can't be determined (e.g. a non-LM-Studio backend).
 */
export function ContextMeter({ messages, model }: { messages: UIMessage[]; model: string | null }) {
  const [contextLength, setContextLength] = useState<number | null>(null);
  // Completed messages are immutable; only the last one mutates while streaming.
  // Splitting the estimate keeps the per-delta cost proportional to the live
  // message instead of re-scanning the whole conversation on every token.
  const headTokens = useMemo(
    () => estimateTokens(messages.slice(0, -1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages.length],
  );
  const last = messages[messages.length - 1];
  const used = headTokens + (last ? estimateTokens([last]) : 0);

  useEffect(() => {
    let active = true;
    const params = model ? `?model=${encodeURIComponent(model)}` : "";
    fetch(`/api/llm/context${params}`)
      .then((r) => r.json())
      .then((d: { contextLength: number | null }) => {
        if (active) setContextLength(d.contextLength);
      })
      .catch(() => {
        if (active) setContextLength(null);
      });
    return () => {
      active = false;
    };
  }, [model]);

  if (!contextLength) return null;

  const pct = Math.min(100, Math.round((used / contextLength) * 100));
  const bar =
    pct >= 90 ? "bg-destructive" : pct >= 75 ? "bg-amber-500" : "bg-primary";
  const label =
    pct >= 90
      ? "text-destructive"
      : pct >= 75
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";

  return (
    <div
      className="flex items-center gap-1.5"
      title={`~${used.toLocaleString()} of ${contextLength.toLocaleString()} tokens used (estimated · ${pct}%)`}
    >
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${bar} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs tabular-nums ${label}`}>
        {compact(used)}/{compact(contextLength)}
      </span>
    </div>
  );
}
