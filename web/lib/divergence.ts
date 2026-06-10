/**
 * Model-vs-market divergence flag. Computed server-side (like upset) and returned in the
 * /api/matches payload; the frontend only displays the badge.
 *
 * Rule (argmax-flip): the model's single most-likely 1X2 outcome differs from the market's
 * (Pinnacle de-vig) most-likely outcome → flag divergence. Same-direction disagreement
 * (e.g. both favour the home team, only the magnitude differs) is NOT flagged.
 *
 * This is purely a "the two views disagree" signal, NOT a value signal. A divergence is far
 * more often a model limitation than a market mispricing (P6-spec §2.3). It never feeds the
 * EV/value path and must be presented neutrally (trap #7 / P5 risk #1). When there is no
 * market (no odds posted), there is nothing to diverge from → null.
 *
 * Pure function (kept testable); shares the argmax definition that a future B6 divergence list
 * (P6-spec §B6) can reuse so the two never drift.
 */
export type Outcome = 'home' | 'draw' | 'away';

export interface Triple {
  home: number;
  draw: number;
  away: number;
}

export interface DivergenceResult {
  flag: boolean;
  modelPick: Outcome;
  marketPick: Outcome;
}

// Most-likely outcome. Deterministic tie-break order: home > draw > away (ties are
// vanishingly rare with real de-vig floats; fixed order keeps the result stable).
export function argmaxOutcome(t: Triple): Outcome {
  if (t.home >= t.draw && t.home >= t.away) return 'home';
  if (t.draw >= t.away) return 'draw';
  return 'away';
}

export function computeDivergence(model: Triple, market: Triple | null): DivergenceResult | null {
  if (!market) return null;
  const modelPick = argmaxOutcome(model);
  const marketPick = argmaxOutcome(market);
  return { flag: modelPick !== marketPick, modelPick, marketPick };
}
