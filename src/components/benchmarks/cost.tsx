"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleDollarSign } from "lucide-react";

import { costOfMs, costPerTokens, formatUsd } from "@/lib/benchmark-cost";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface CostModelRow {
  label: string;
  color: string;
  totalLatencyMs: number;
  totalOutputTokens: number | null;
  avgTokensPerSecond: number | null;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const numberOr = (text: string, fallback: number): number => {
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/**
 * What-if calculator: tokens ÷ measured tokens/sec × $/hour → estimated $, so
 * local throughput can be compared against hosted per-token pricing.
 */
function Calculator({ defaultTps, rate }: { defaultTps: number | null; rate: number }) {
  const [tokensText, setTokensText] = useState("1000000");
  const [tpsText, setTpsText] = useState(defaultTps !== null ? defaultTps.toFixed(1) : "");
  const [rateText, setRateText] = useState(String(rate));

  const tokens = numberOr(tokensText, 0);
  const tps = numberOr(tpsText, 0);
  const perHour = numberOr(rateText, 0);
  const cost = tokens > 0 && tps > 0 && perHour > 0 ? costPerTokens(tokens, tps, perHour) : null;

  return (
    <div className="bg-card/80 flex min-w-0 flex-col gap-3 rounded-lg border p-4">
      <h3 className="text-sm font-medium">Token cost calculator</h3>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label htmlFor="calc-tokens" className="text-xs">
            Tokens
          </Label>
          <Input
            id="calc-tokens"
            type="number"
            min="0"
            value={tokensText}
            onChange={(e) => setTokensText(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="calc-tps" className="text-xs">
            Tokens/sec
          </Label>
          <Input
            id="calc-tps"
            type="number"
            min="0"
            step="0.1"
            placeholder="measured"
            value={tpsText}
            onChange={(e) => setTpsText(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="calc-rate" className="text-xs">
            $/hour
          </Label>
          <Input
            id="calc-rate"
            type="number"
            min="0"
            step="0.01"
            value={rateText}
            onChange={(e) => setRateText(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
      </div>
      <div className="flex gap-1.5">
        {[
          { label: "1K", value: "1000" },
          { label: "100K", value: "100000" },
          { label: "1M", value: "1000000" },
        ].map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => setTokensText(preset.value)}
            className={`rounded border px-2 py-0.5 text-xs transition-colors ${
              tokensText === preset.value
                ? "border-neon-cyan/60 text-neon-cyan"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <p className="text-sm">
        {cost !== null ? (
          <>
            ≈ <span className="text-neon-green font-semibold">{formatUsd(cost)}</span>{" "}
            <span className="text-muted-foreground text-xs">
              for {Number(tokensText).toLocaleString("en")} tokens (
              {formatDuration((tokens / tps) * 1000)} of generation)
            </span>
          </>
        ) : (
          <span className="text-muted-foreground text-xs">
            Enter tokens, a measured speed, and a rate.
          </span>
        )}
      </p>
    </div>
  );
}

export function CostPanel({
  models,
  rate,
  rateSource,
  wallClockMs,
}: {
  models: CostModelRow[];
  /** Effective $/hour for this run; null = no rate configured anywhere. */
  rate: number | null;
  rateSource: "snapshot" | "settings" | null;
  wallClockMs: number | null;
}) {
  if (rate === null) {
    return (
      <div className="bg-card/80 flex items-start gap-3 rounded-lg border border-dashed p-4">
        <CircleDollarSign className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <p className="text-muted-foreground text-xs leading-relaxed">
          No machine rate configured. Set your compute cost ($/hour) in{" "}
          <Link href="/settings" className="text-neon-cyan underline underline-offset-2">
            Settings → Compute cost
          </Link>{" "}
          to see estimated $ per run and per 1K/1M tokens here. Local inference is never
          metered — this is purely your own estimate.
        </p>
      </div>
    );
  }

  const bestTps = models
    .map((m) => m.avgTokensPerSecond)
    .filter((v): v is number => v !== null && v > 0)
    .sort((a, b) => b - a)[0];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="bg-card/80 min-w-0 rounded-lg border p-4">
          <h3 className="mb-3 text-sm font-medium">Estimated run cost</h3>
          <ul className="space-y-2">
            {models.map((m) => (
              <li key={m.label} className="flex items-baseline gap-2 text-xs">
                <span
                  className="inline-block size-2 shrink-0 self-center rounded-full"
                  style={{ background: m.color }}
                />
                <span className="min-w-0 flex-1 truncate font-mono">{m.label}</span>
                <span
                  className="text-neon-green font-medium"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  ~{formatUsd(costOfMs(m.totalLatencyMs, rate))}
                </span>
                <span
                  className="text-muted-foreground w-52 text-right"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatDuration(m.totalLatencyMs)}
                  {m.totalOutputTokens !== null
                    ? ` · ${m.totalOutputTokens.toLocaleString("en")} tok`
                    : ""}
                  {m.avgTokensPerSecond !== null && m.avgTokensPerSecond > 0
                    ? ` · ~${formatUsd(costPerTokens(1_000_000, m.avgTokensPerSecond, rate))}/1M`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
          {wallClockMs !== null ? (
            <p className="text-muted-foreground mt-3 text-xs">
              Whole run wall clock: {formatDuration(wallClockMs)} ≈ ~
              {formatUsd(costOfMs(wallClockMs, rate))}
            </p>
          ) : null}
        </div>
        <Calculator defaultTps={bestTps ?? null} rate={rate} />
      </div>
      <p className="text-muted-foreground text-xs">
        Self-reported estimate: time × your ${rate}/hr rate
        {rateSource === "settings" ? " (current Settings value)" : " (rate when the run started)"}.
        Local inference has no metered billing — treat these as ballpark figures.
      </p>
    </div>
  );
}
