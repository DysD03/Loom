"use client";

import { useState } from "react";
import { getToolName, type DynamicToolUIPart, type ToolUIPart } from "ai";
import { ChevronDown, ChevronRight, TriangleAlert, Wrench } from "lucide-react";

type AnyToolPart = ToolUIPart | DynamicToolUIPart;

function truncate(val: unknown, maxLen = 600): string {
  const str = typeof val === "string" ? val : JSON.stringify(val, null, 2);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "…";
}

export function ToolCallBlock({ part }: { part: AnyToolPart }) {
  const [open, setOpen] = useState(false);
  const name = getToolName(part);
  const { state } = part;
  const input = "input" in part ? part.input : undefined;
  const output = "output" in part ? part.output : undefined;
  const errorText = "errorText" in part ? part.errorText : undefined;

  const isRunning = state === "input-streaming" || state === "input-available";
  const isError = state === "output-error";
  const label = isRunning ? `Running ${name}…` : name;

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 text-xs">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground hover:text-foreground"
      >
        {isError ? (
          <TriangleAlert className="size-3 shrink-0 text-destructive" />
        ) : (
          <Wrench className="size-3 shrink-0" />
        )}
        <span className="flex-1 font-mono">{label}</span>
        {isRunning ? (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        ) : open ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
      </button>

      {open && !isRunning ? (
        <div className="space-y-2 border-t border-border/60 px-3 py-2">
          {input !== undefined ? (
            <div>
              <p
                className="mb-1 font-semibold tracking-wide text-muted-foreground uppercase"
                style={{ fontSize: "10px" }}
              >
                Input
              </p>
              <pre className="break-all whitespace-pre-wrap">{truncate(input)}</pre>
            </div>
          ) : null}
          {isError ? (
            <div>
              <p
                className="mb-1 font-semibold tracking-wide text-destructive uppercase"
                style={{ fontSize: "10px" }}
              >
                Error
              </p>
              <pre className="break-all whitespace-pre-wrap text-destructive">
                {truncate(errorText)}
              </pre>
            </div>
          ) : output !== undefined ? (
            <div>
              <p
                className="mb-1 font-semibold tracking-wide text-muted-foreground uppercase"
                style={{ fontSize: "10px" }}
              >
                Output
              </p>
              <pre className="break-all whitespace-pre-wrap">{truncate(output)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
