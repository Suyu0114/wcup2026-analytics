/**
 * Inverse of lib/value.ts `toDecimal`: decimal odds → each format. Display-only (the guide's
 * OddsConverter widget). The EV value path never uses these — they live here, NOT in value.ts,
 * so value.ts stays a faithful port of engine/value.py (no extra surface, no golden-vector churn).
 *
 * Boundaries match value.py `to_decimal` exactly (verified by tests/oddsFormat.test.ts round-trip):
 * american/indonesian are positive at d ≥ 2, malaysian is positive at d ≤ 2.
 */
export function fromDecimal(d: number, fmt: string): number {
  if (d <= 1) throw new Error(`decimal odds must be > 1 (got ${d})`);
  const f = fmt.toLowerCase();
  switch (f) {
    case 'decimal':
      return d;
    case 'hongkong':
    case 'hk':
      return d - 1;
    case 'american':
    case 'us':
    case 'moneyline':
      return d >= 2 ? (d - 1) * 100 : -100 / (d - 1);
    case 'indonesian':
    case 'indo':
      return d >= 2 ? d - 1 : -1 / (d - 1);
    case 'malaysian':
    case 'malay':
      return d <= 2 ? d - 1 : -1 / (d - 1);
    default:
      throw new Error(`unknown odds format ${fmt}`);
  }
}
