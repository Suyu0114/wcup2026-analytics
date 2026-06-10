import { describe, it, expect } from 'vitest';
import { selectProb, fairProb } from '../lib/selectProb';
import type { ValueMarketResponse } from '../lib/types';

// TB8b: the single mode->probability selection point returns the right (p, source)
// for every branch; decision #6 (no market => unavailable in EVERY mode).

const GRID = [1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5, 3.75, 4.0, 4.25, 4.5].map((point) => ({
  point,
  p_over: 0.5,
  p_under: point === Math.floor(point) ? 0.4 : 0.5,
  p_push: point === Math.floor(point) ? 0.1 : 0.0,
}));

function resp(over: Partial<ValueMarketResponse>): ValueMarketResponse {
  return {
    match_id: 'm1', market: 'h2h', outcome: 'home', market_available: true,
    pinnacle_main_point: null, pinnacle_novig: 0.4, is_quarter_line: null,
    best_available: null, line_shopping: [],
    model_h2h: { model_version: 'v', p_home: 0.7, p_draw: 0.2, p_away: 0.1 },
    model_totals_grid: null, calibration: null, freshness: null,
    ...over,
  };
}

describe('selectProb (TB8b)', () => {
  it('market mode -> pinnacle_novig with market source', () => {
    expect(selectProb('market', resp({}), null)).toEqual({ kind: 'binary', source: 'market', p: 0.4 });
  });

  it('model mode h2h -> the model probability for the outcome', () => {
    expect(selectProb('model', resp({}), null)).toEqual({ kind: 'binary', source: 'model', p: 0.7 });
    expect(selectProb('model', resp({ outcome: 'away' }), null)).toEqual({ kind: 'binary', source: 'model', p: 0.1 });
  });

  it('no market -> unavailable in EVERY mode (decision #6)', () => {
    const noMkt = resp({ market_available: false, pinnacle_novig: null });
    expect(selectProb('market', noMkt, null).kind).toBe('unavailable');
    expect(selectProb('model', noMkt, null).kind).toBe('unavailable');
  });

  it('model totals: half/integer line -> push kind from the grid entry', () => {
    const d = resp({ market: 'totals', outcome: 'over', model_totals_grid: GRID, pinnacle_main_point: 2.5 });
    expect(selectProb('model', d, 2.5)).toEqual({ kind: 'push', source: 'model', pWin: 0.5, pPush: 0.0 });
    expect(selectProb('model', d, 3.0)).toEqual({ kind: 'push', source: 'model', pWin: 0.5, pPush: 0.1 });
    const under = resp({ market: 'totals', outcome: 'under', model_totals_grid: GRID, pinnacle_main_point: 2.5 });
    expect(selectProb('model', under, 3.0)).toEqual({ kind: 'push', source: 'model', pWin: 0.4, pPush: 0.1 });
  });

  it('model totals: quarter line -> components from neighbouring grid lines', () => {
    const d = resp({ market: 'totals', outcome: 'over', model_totals_grid: GRID, pinnacle_main_point: 2.5 });
    expect(selectProb('model', d, 2.25)).toEqual({
      kind: 'quarter', source: 'model', lo: [0.5, 0.1], hi: [0.5, 0.0],
    });
  });

  it('model totals: outside the grid or off-step -> line-out-of-range', () => {
    const d = resp({ market: 'totals', outcome: 'over', model_totals_grid: GRID, pinnacle_main_point: 2.5 });
    for (const pt of [1.25, 4.75, 2.3, null]) {
      const s = selectProb('model', d, pt as number | null);
      expect(s.kind).toBe('unavailable');
      if (s.kind === 'unavailable') expect(s.reason).toBe('line-out-of-range');
    }
  });

  it('fairProb conditions on no-push', () => {
    expect(fairProb({ kind: 'binary', source: 'market', p: 0.4 })).toBeCloseTo(0.4, 12);
    // pWin .5, pPush .1 -> pLose .4 -> conditioned .5/.9
    expect(fairProb({ kind: 'push', source: 'model', pWin: 0.5, pPush: 0.1 })).toBeCloseTo(0.5 / 0.9, 12);
  });
});
