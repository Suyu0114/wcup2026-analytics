import { describe, it, expect } from 'vitest';
import { verdictTier, per100, breakeven } from '../lib/verdict';
import { divergenceList } from '../lib/divergence';
import type { MatchView } from '../lib/types';

// TB4: tier boundaries (🟢 EV>0 / 🟡 ≥ −0.025 / 🔴 below) + plain-language numbers.

describe('verdictTier (TB4)', () => {
  it('boundaries', () => {
    expect(verdictTier(0.001)).toBe('good');
    expect(verdictTier(0)).toBe('nearFair');        // EV ≤ 0 is never "good"
    expect(verdictTier(-0.025)).toBe('nearFair');   // inclusive threshold
    expect(verdictTier(-0.0251)).toBe('expensive');
  });
  it('per100 / breakeven consistency', () => {
    expect(per100(-0.045)).toBeCloseTo(-4.5, 12);
    expect(breakeven(2.0)).toBeCloseTo(0.5, 12);
  });
});

// TB10: divergence screener ordering + filtering.

function mv(id: string, pHome: number, mktHome: number, status = 'scheduled'): MatchView {
  return {
    match_id: id, stage: 'group', group_label: 'A', kickoff_utc: '2026-06-12T00:00:00Z', status,
    home: { team_id: 'H' + id, name_en: 'H' + id, name_zh: null, elo: 1800 },
    away: { team_id: 'A' + id, name_en: 'A' + id, name_zh: null, elo: 1700 },
    model: {
      model_version: 'dc-v1.1', p_home: pHome, p_draw: 0.2, p_away: 1 - pHome - 0.2,
      p_over_2_5: 0.5, p_btts: null, exp_total_goals: 2.4, upset: { tier: null, weaker: null },
    },
    market: {
      pinnacle_novig: { home: mktHome, draw: 0.2, away: 1 - mktHome - 0.2 },
      best_h2h: null, freshness: null,
    },
  };
}

describe('divergenceList (TB10)', () => {
  it('sorts by abs diff desc and keeps only scheduled matches with both sides', () => {
    const rows = divergenceList([
      mv('a', 0.50, 0.45),                 // diff .05
      mv('b', 0.70, 0.40),                 // diff .30 -> first
      mv('c', 0.70, 0.40, 'final'),        // settled -> excluded
      { ...mv('d', 0.7, 0.4), market: null },   // no market -> excluded
      { ...mv('e', 0.7, 0.4), model: null },    // no model -> excluded
    ]);
    expect(rows.map((r) => r.match_id)).toEqual(['b', 'a']);
    expect(rows[0].outcome).toBe('home');
    expect(rows[0].diff).toBeCloseTo(0.3, 12);
  });

  it('caps at top N', () => {
    const many = Array.from({ length: 15 }, (_, i) => mv(`m${i}`, 0.5 + i * 0.01, 0.4));
    expect(divergenceList(many, 10)).toHaveLength(10);
  });
});
