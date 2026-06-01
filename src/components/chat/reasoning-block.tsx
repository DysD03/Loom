"use client";

import { useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";

export function ReasoningBlock({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md border border-border/50 bg-muted/20 text-xs">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground hover:text-foreground"
      >
        <Brain className="size-3 shrink-0" />
        <span className="flex-1 italic">{streaming ? "Thinking…" : "Thought process"}</span>
        {streaming ? (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
        ) : open ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
      </button>

      {open ? (
        <div className="border-t border-border/50 px-3 py-2">
          <pre className="break-words whitespace-pre-wrap text-muted-foreground">{text}</pre>
        </div>
      ) : null}
    </div>
  );
}
