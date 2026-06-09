/**
 * EV / value calculator — pure functions (P5 §5.1, port of engine/value.py). No I/O.
 *
 * ⚠️ value uses the Pinnacle de-vig probability ONLY (P3 decision #1 / TV4 / spec D4).
 * Model probability never enters this module — there is no model parameter anywhere here.
 * `novig` is intentionally NOT ported here; it lives server-side in lib/devig.ts (Issue 4).
 *
 * This file is the client-side arithmetic for /value and the parity reference against
 * engine/value.py (TU5 golden vectors).
 */

export const KELLY_FRACTION_DEFAULT = 0.25;

// --- odds format -> decimal (P3 §5.6) ---
export function toDecimal(value: number, fmt: string): number {
  const f = fmt.toLowerCase();
  let d: number;
  if (f === 'decimal') {
    d = value;
  } else if (f === 'hongkong' || f === 'hk') {
    d = value + 1.0;
  } else if (f === 'american' || f === 'us' || f === 'moneyline') {
    d = 1.0 + (value > 0 ? value / 100.0 : 100.0 / Math.abs(value));
  } else if (f === 'indonesian' || f === 'indo') {
    d = value > 0 ? value + 1.0 : 1.0 + 1.0 / Math.abs(value);
  } else if (f === 'malaysian' || f === 'malay') {
    d = value > 0 ? value + 1.0 : 1.0 + 1.0 / Math.abs(value);
  } else {
    throw new Error(`unknown odds format ${fmt}`);
  }
  if (d <= 1.0) {
    throw new Error(`decimal odds must be > 1 (got ${d})`);
  }
  return d;
}

// --- EV / value (P3 §5.0) ---
export function ev(pNovig: number, decimalOdds: number): number {
  return pNovig * decimalOdds - 1.0;
}

export function isValue(pNovig: number, decimalOdds: number): boolean {
  return ev(pNovig, decimalOdds) > 0.0;
}

// --- Kelly: fraction of bankroll (P3 §5.3) ---
export function kellyFraction(
  pNovig: number,
  decimalOdds: number,
  fraction: number = KELLY_FRACTION_DEFAULT,
): number {
  const fStar = (decimalOdds * pNovig - 1.0) / (decimalOdds - 1.0);
  return Math.max(0.0, fraction * fStar); // negative EV -> 0
}

// --- totals line helpers (P3 §5.2) ---
export function isQuarterLine(point: number): boolean {
  // 2.25 / 2.75 -> true (half-push settlement -> EV/Kelly approximate)
  return (2.0 * point) % 1.0 !== 0.0;
}

export function totalsLineMatches(userPoint: number, pinnacleMainPoint: number): boolean {
  return userPoint === pinnacleMainPoint;
}

// --- line-shopping best available — caller passes ONE outcome at ONE line (P3 §5.5 / TV7) ---
export function bestAvailable(pricesByBook: Record<string, number>): [string, number] {
  let book = '';
  let best = -Infinity;
  for (const [b, p] of Object.entries(pricesByBook)) {
    if (p > best) {
      best = p;
      book = b;
    }
  }
  return [book, best];
}

export interface EvaluateOptions {
  point?: number | null;
  pinnacleMainPoint?: number | null;
  fraction?: number;
}

export interface EvaluateResult {
  decimal_odds: number;
  implied_prob: number;
  p_pinnacle_novig: number;
  line_mismatch: boolean;
  ev: number | null;
  value: boolean | null;
  kelly_fraction: number | null;
  approximate?: boolean;
}

/**
 * Frontend-facing result (mirrors engine/value.py evaluate). totals require the Pinnacle
 * main line; mismatch => no EV/value. Quarter lines => 'approximate' flag. value uses
 * p_novig only.
 */
export function evaluate(
  pNovig: number,
  userValue: number,
  userFormat: string = 'decimal',
  opts: EvaluateOptions = {},
): EvaluateResult {
  const fraction = opts.fraction ?? KELLY_FRACTION_DEFAULT;
  const point = opts.point ?? null;
  const pinnacleMainPoint = opts.pinnacleMainPoint ?? null;

  const d = toDecimal(userValue, userFormat);
  const out: EvaluateResult = {
    decimal_odds: d,
    implied_prob: 1.0 / d,
    p_pinnacle_novig: pNovig,
    line_mismatch: false,
    ev: null,
    value: null,
    kelly_fraction: null,
  };

  if (point !== null && (pinnacleMainPoint === null || !totalsLineMatches(point, pinnacleMainPoint))) {
    out.line_mismatch = true;
    return out;
  }

  const e = ev(pNovig, d);
  out.line_mismatch = false;
  out.ev = e;
  out.value = e > 0.0;
  out.kelly_fraction = kellyFraction(pNovig, d, fraction);
  out.approximate = point !== null && isQuarterLine(point);
  return out;
}
