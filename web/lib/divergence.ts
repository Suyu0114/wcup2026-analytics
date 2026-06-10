/**
 * Model-vs-market divergence screener (P6 §3.7 / TB10). Pure; server component
 * feeds it getMatches() output. Display-only: a big divergence usually means the
 * model is wrong, not the market (disclaimer rendered alongside).
 */
import type { MatchView } from './types';

export interface DivergenceRow {
  match_id: string;
  outcome: 'home' | 'draw' | 'away';
  model_p: number;
  market_p: number;
  diff: number; // model − market (signed)
  kickoff_utc: string;
  home: MatchView['home'];
  away: MatchView['away'];
}

const OUTCOMES = ['home', 'draw', 'away'] as const;

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
