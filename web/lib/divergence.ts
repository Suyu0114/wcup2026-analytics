/**
 * Model-vs-market divergence — two display-only views over the same comparison:
 *
 * 1. computeDivergence (badge, /matches): argmax-flip — the model's single most-likely 1X2
 *    outcome differs from the market's (Pinnacle de-vig). Same-direction disagreement is NOT
 *    flagged. Computed server-side (like upset); the frontend only displays the badge.
 * 2. divergenceList (screener, /value top — P6 §3.7 / TB10): per upcoming match, the outcome
 *    with the largest |model − market| gap, top-N sorted by that gap; feeds the calculator
 *    prefill links.
 *
 * Both are "the two views disagree" signals, NEVER value signals. A divergence is far more
 * often a model limitation than a market mispricing (P6-spec §2.3); a disclaimer is rendered
 * alongside, and nothing here feeds the EV/value path (trap #7 / P5 risk #1). No market
 * (no odds posted) → nothing to diverge from → null / skipped.
 *
 * Pure functions (kept testable); both share the Outcome type so badge and screener never drift.
 */
import type { MatchView } from './types';

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

const OUTCOMES = ['home', 'draw', 'away'] as const;

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

export interface DivergenceRow {
  match_id: string;
  outcome: Outcome;
  model_p: number;
  market_p: number;
  diff: number; // model − market (signed)
  kickoff_utc: string;
  home: MatchView['home'];
  away: MatchView['away'];
}

export function divergenceList(matches: MatchView[], top = 10): DivergenceRow[] {
  const rows: DivergenceRow[] = [];
  for (const m of matches) {
    if (m.status !== 'scheduled') continue; // upcoming only
    const novig = m.market?.pinnacle_novig;
    if (!m.model || !novig) continue;
    const modelP = { home: m.model.p_home, draw: m.model.p_draw, away: m.model.p_away };
    let best: DivergenceRow | null = null;
    for (const o of OUTCOMES) {
      const diff = modelP[o] - novig[o];
      if (best === null || Math.abs(diff) > Math.abs(best.diff)) {
        best = {
          match_id: m.match_id,
          outcome: o,
          model_p: modelP[o],
          market_p: novig[o],
          diff,
          kickoff_utc: m.kickoff_utc,
          home: m.home,
          away: m.away,
        };
      }
    }
    if (best) rows.push(best);
  }
  rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return rows.slice(0, top);
}
