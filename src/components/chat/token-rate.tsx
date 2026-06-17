"use client";

import { useEffect, useRef, useState } from "react";
import { Gauge } from "lucide-react";
import type { UIMessage } from "ai";

/**
 * Estimated tokens (~4 chars each) the model generated in a message: text and
 * reasoning parts only — tool results come from tools, not the model.
 */
export function generatedTokens(message: UIMessage | undefined): number {
  if (!message || message.role !== "assistant") {
    return 0;
  }
  let chars = 0;
  for (const part of message.parts) {
    if (part.type === "text" || part.type === "reasoning") {
      chars += part.text.length;
    }
  }
  return Math.ceil(chars / 4);
}

export function formatRate(rate: number): string {
  return `${rate >= 10 ? Math.round(rate) : rate.toFixed(1)} tok/s`;
}

const SAMPLE_MS = 500;
const MIN_WINDOW_S = 0.5;

/**
 * Live generation speed for a streaming run. `tokens` is the estimated count
 * generated so far; the clock starts at the first observed token, so prompt
 * processing / model load time doesn't skew the rate. The finished run's
 * average sticks around until the next run starts.
 */
function useTokenRate(tokens: number, active: boolean): number | null {
  const [rate, setRate] = useState<number | null>(null);
  const tokensRef = useRef(tokens);

  useEffect(() => {
    tokensRef.current = tokens;
  }, [tokens]);

  useEffect(() => {
    if (!active) {
      return;
    }
    // The previous run's rate stays visible until this run's first sample lands.
    let start: { time: number; tokens: number } | null = null;
    const sample = () => {
      const current = tokensRef.current;
      if (!start) {
        if (current > 0) {
          start = { time: performance.now(), tokens: current };
        }
        return;
      }
      const seconds = (performance.now() - start.time) / 1000;
      const generated = current - start.tokens;
      if (seconds >= MIN_WINDOW_S && generated > 0) {
        setRate(generated / seconds);
      }
    };
    const timer = setInterval(sample, SAMPLE_MS);
    return () => {
      sample(); // one last sample so the displayed rate is the run's average
      clearInterval(timer);
    };
  }, [active]);

  return rate;
}

/** A small tokens-per-second chip for tab headers; hidden until a run produces a rate. */
export function TokenRate({ tokens, active }: { tokens: number; active: boolean }) {
  const rate = useTokenRate(tokens, active);
  if (rate === null) {
    return null;
  }
  return (
    <span
      className="text-muted-foreground flex items-center gap-1 text-xs tabular-nums"
      title="Estimated generation speed (~4 characters per token), measured from the first streamed token"
    >
      <Gauge className="size-3.5" />
      {formatRate(rate)}
    </span>
  );
}
