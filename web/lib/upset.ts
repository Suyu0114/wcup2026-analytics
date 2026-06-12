/**
 * Upset-risk rule (P1 §5.4 / spec §6.3). Computed server-side (Issue 3) and returned in the
 * /api/matches payload; the frontend only displays the tier badge.
 *
 * Three cascading tiers (checked A+ → A → B; first match wins):
 *   A+: |Δelo| ≥ 250 AND weaker not-lose ≥ 0.35  (extreme)
 *   A:  |Δelo| ≥ 200 AND weaker not-lose ≥ 0.35  (strong)
 *   B:  |Δelo| ≥ 150 AND weaker not-lose ≥ 0.40  (moderate)
 *
 * Pure function (kept testable, TU13); thresholds are adjustable constants in constants.ts,
 * NOT baked into the prediction engine.
 */
import { UPSET_TIERS, type UpsetTier } from './constants';

export interface UpsetInput {
  homeTeam: string;
  awayTeam: string;
  eloHome: number;
  eloAway: number;
  pHome: number;
  pDraw: number;
  pAway: number;
}

export interface UpsetResult {
  tier: UpsetTier | null;
  weaker: string | null;
}

export function computeUpset(
  input: UpsetInput,
  tiersOverride?: readonly { tier: UpsetTier; eloGap: number; prob: number }[],
): UpsetResult {
  const tiers = tiersOverride ?? UPSET_TIERS;
  const gap = Math.abs(input.eloHome - input.eloAway);
  const homeIsWeaker = input.eloHome < input.eloAway;
  const weaker = homeIsWeaker ? input.homeTeam : input.awayTeam;
  // not-lose prob of the weaker team = its win prob + draw prob
  const notLose = (homeIsWeaker ? input.pHome : input.pAway) + input.pDraw;

  for (const t of tiers) {
    if (gap >= t.eloGap && notLose >= t.prob) {
      return { tier: t.tier, weaker };
    }
  }
  return { tier: null, weaker: gap >= (tiers[tiers.length - 1]?.eloGap ?? 150) ? weaker : null };
}
