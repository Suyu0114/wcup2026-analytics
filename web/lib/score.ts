/**
 * Result scoring (P9) — TS port of the Python calibration scoring
 * (etl/calibrate.py `result_1x2` / `brier`) so the track-record page stays consistent
 * with the calibration job. Pure, model-free, testable.
 *
 * The "pick" (argmax of a probability triple) is NOT redefined here — it reuses
 * `argmaxOutcome` from divergence.ts so badge, screener and track record never drift.
 */
import type { Outcome, Triple } from './divergence';

const OUTCOMES = ['home', 'draw', 'away'] as const;

/** Actual 1X2 outcome from a final score (mirrors etl/calibrate.py:26). */
export function result1x2(homeGoals: number, awayGoals: number): Outcome {
  if (homeGoals > awayGoals) return 'home';
  if (homeGoals < awayGoals) return 'away';
  return 'draw';
}

/** Brier score for a 1X2 prediction against the realised outcome (mirrors etl/calibrate.py:34). */
export function brier(probs: Triple, outcome: Outcome): number {
  return OUTCOMES.reduce((s, o) => s + (probs[o] - (o === outcome ? 1 : 0)) ** 2, 0);
}

/** How the upset-risk tag played out: did the weaker (lower-Elo) team win, draw, or lose?
 *  Leads the "did the upset materialise" read — won OR drew = not-lost (the tier's own basis). */
export type UpsetMaterialization = 'won' | 'drew' | 'lost';

export function classifyUpset(
  weakerTeam: string,
  homeTeam: string,
  homeGoals: number,
  awayGoals: number,
): UpsetMaterialization {
  const weakerIsHome = weakerTeam === homeTeam;
  const weakerGoals = weakerIsHome ? homeGoals : awayGoals;
  const otherGoals = weakerIsHome ? awayGoals : homeGoals;
  if (weakerGoals > otherGoals) return 'won';
  if (weakerGoals < otherGoals) return 'lost';
  return 'drew';
}
