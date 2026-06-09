/**
 * De-vig: proportional normalization (P3 §5.1). SERVER-ONLY by convention (spec §5.1 / Issue 4):
 * called from API routes / server data helpers to produce `pinnacle_novig`. It is deliberately
 * NOT in lib/value.ts so the client-side value path can only consume the server-computed
 * probability (keeps the value/model isolation contract simple — TV4 / D5).
 *
 * Kept as a plain pure function (no `server-only` import) so it stays unit-testable.
 */
export function novig(prices: Record<string, number>): Record<string, number> {
  const raw: Record<string, number> = {};
  let s = 0;
  for (const [o, p] of Object.entries(prices)) {
    const r = 1.0 / p;
    raw[o] = r;
    s += r; // overround > 1
  }
  const out: Record<string, number> = {};
  for (const [o, r] of Object.entries(raw)) {
    out[o] = r / s; // Σ = 1
  }
  return out;
}
