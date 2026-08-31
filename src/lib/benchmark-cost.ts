/**
 * Compute-cost estimation for benchmark runs. Local inference has no metered
 * billing, so every figure here is derived from the user's self-reported
 * $/hour machine rate (Settings → Compute cost) — an estimate, never a bill.
 * Pure client-safe functions shared by the run view, history, and calculator.
 */

/** Wall-clock milliseconds at a $/hour rate → estimated $. */
export function costOfMs(ms: number, perHour: number): number {
  return (ms / 3_600_000) * perHour;
}

/** Estimated $ per `tokens` generated at a measured tokens/sec and $/hour rate. */
export function costPerTokens(
  tokens: number,
  tokensPerSecond: number,
  perHour: number,
): number {
  if (tokensPerSecond <= 0) return 0;
  return costOfMs((tokens / tokensPerSecond) * 1000, perHour);
}

// --- metered (cloud) pricing ------------------------------------------------

/**
 * A per-token price the user supplies for a metered provider. `match` is a
 * prefix of the stored model id, so a single row can cover a whole provider
 * ("anthropic/") or pin one model ("anthropic/claude-opus-4-1"); the longest
 * matching prefix wins, which lets a specific model override a provider default.
 */
export interface TokenPrice {
  match: string;
  /** USD per 1,000,000 input tokens. */
  input: number;
  /** USD per 1,000,000 output tokens. */
  output: number;
}

/** Parses the settings JSON; a corrupt value yields no pricing rather than throwing. */
export function parseTokenPricing(raw: string): TokenPrice[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is TokenPrice =>
        typeof row === "object" &&
        row !== null &&
        typeof (row as TokenPrice).match === "string" &&
        typeof (row as TokenPrice).input === "number" &&
        typeof (row as TokenPrice).output === "number",
    );
  } catch {
    return [];
  }
}

/** The most specific price whose `match` prefixes this model id; null when none does. */
export function priceFor(model: string, pricing: TokenPrice[]): TokenPrice | null {
  const id = model.trim().toLowerCase();
  let best: TokenPrice | null = null;
  for (const row of pricing) {
    const match = row.match.trim().toLowerCase();
    if (!match || !id.startsWith(match)) continue;
    if (!best || match.length > best.match.trim().length) best = row;
  }
  return best;
}

/**
 * How a cost figure was arrived at. Metered providers bill per token, so
 * applying the machine's $/hour to them would be simply wrong — such a model
 * reports "unknown" until its price is configured, rather than a plausible
 * number that happens to be meaningless.
 */
export type CostBasis = "machine" | "tokens" | "unknown";

export interface CostEstimate {
  amount: number | null;
  basis: CostBasis;
}

export function estimateCost(input: {
  /** True when the model runs on the user's own hardware. */
  local: boolean;
  model: string;
  totalLatencyMs: number;
  promptTokens: number | null;
  outputTokens: number | null;
  perHour: number | null;
  pricing: TokenPrice[];
}): CostEstimate {
  if (input.local) {
    if (input.perHour === null) return { amount: null, basis: "unknown" };
    return { amount: costOfMs(input.totalLatencyMs, input.perHour), basis: "machine" };
  }
  const price = priceFor(input.model, input.pricing);
  if (!price) return { amount: null, basis: "unknown" };
  const inTokens = input.promptTokens ?? 0;
  const outTokens = input.outputTokens ?? 0;
  return {
    amount: (inTokens / 1_000_000) * price.input + (outTokens / 1_000_000) * price.output,
    basis: "tokens",
  };
}

/** Estimated $ for `tokens` output at a metered price. */
export function costPerOutputTokens(tokens: number, price: TokenPrice): number {
  return (tokens / 1_000_000) * price.output;
}

/** Tiered $ formatter that keeps sub-cent estimates legible (e.g. $0.00042). */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  if (value === 0) return "$0";
  if (value < 0.0001) return `$${value.toExponential(1)}`;
  if (value < 0.01) return `$${value.toFixed(5).replace(/0+$/, "").replace(/\.$/, "")}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}
