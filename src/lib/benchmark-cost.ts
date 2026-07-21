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
export function costPerTokens(tokens: number, tokensPerSecond: number, perHour: number): number {
  if (tokensPerSecond <= 0) return 0;
  return costOfMs((tokens / tokensPerSecond) * 1000, perHour);
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
