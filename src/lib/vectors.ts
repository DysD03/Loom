import "server-only";

/** Parses a JSON-encoded number[] into a Float32Array, or null when absent/corrupt. */
export function parseVector(json: string | null): Float32Array | null {
  if (!json) {
    return null;
  }
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? Float32Array.from(parsed as number[]) : null;
  } catch {
    return null;
  }
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
