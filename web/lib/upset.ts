/**
 * Upset-risk rule (P1 §5.4 / spec §6.3). Computed server-side (Issue 3) and returned in the
 * /api/matches payload; the frontend only displays the flag.
 *
 * Rule: |Δelo| >= UPSET_ELO_GAP (crowd expects a one-sided result) AND the weaker team's
 * not-lose probability (p_win + p_draw) >= UPSET_PROB → flag upset risk.
 *
 * Pure function (kept testable, TU13); thresholds are adjustable constants, NOT baked into
 * the prediction engine.
 */
import { UPSET_ELO_GAP, UPSET_PROB } from './constants';

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
  flag: boolean;
  weaker: string | null;
}

export function computeUpset(
  input: UpsetInput,
  eloGap: number = UPSET_ELO_GAP,
  prob: number = UPSET_PROB,
): UpsetResult {
  const gap = Math.abs(input.eloHome - input.eloAway);
  if (gap < eloGap) {
    return { flag: false, weaker: null };
  }
  const homeIsWeaker = input.eloHome < input.eloAway;
  const weaker = homeIsWeaker ? input.homeTeam : input.awayTeam;
  // not-lose prob of the weaker team = its win prob + draw prob
  const notLose = (homeIsWeaker ? input.pHome : input.pAway) + input.pDraw;
  return { flag: notLose >= prob, weaker };
}
