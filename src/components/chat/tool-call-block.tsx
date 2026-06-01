"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";

type ToolInvocationPart = {
  type: "tool-invocation";
  toolInvocation: {
    toolCallId: string;
    toolName: string;
    state: "call" | "partial-call" | "result";
    args?: unknown;
    result?: unknown;
  };
};

function truncate(val: unknown, maxLen = 300): string {
  const str = typeof val === "string" ? val : JSON.stringify(val, null, 2);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "…";
}

export function ToolCallBlock({ part }: { part: ToolInvocationPart }) {
  const [open, setOpen] = useState(false);
  const { toolName, state, args, result } = part.toolInvocation;

  const isRunning = state === "call" || state === "partial-call";
  const label = isRunning ? `Running ${toolName}…` : toolName;

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 text-xs">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground hover:text-foreground"
      >
        <Wrench className="size-3 shrink-0" />
        <span className="flex-1 font-mono">{label}</span>
        {isRunning ? (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        ) : (
          open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />
        )}
      </button>

      {open && !isRunning ? (
        <div className="border-t border-border/60 px-3 py-2 space-y-2">
          {args !== undefined ? (
            <div>
              <p className="text-muted-foreground mb-1 font-semibold uppercase tracking-wide" style={{ fontSize: "10px" }}>
                Input
              </p>
              <pre className="whitespace-pre-wrap break-all">{truncate(args)}</pre>
            </div>
          ) : null}
          {result !== undefined ? (
            <div>
              <p className="text-muted-foreground mb-1 font-semibold uppercase tracking-wide" style={{ fontSize: "10px" }}>
                Output
              </p>
              <pre className="whitespace-pre-wrap break-all">{truncate(result)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
