/**
 * Mode -> probability selection — the SINGLE selection point (P6 §3.1 / TB8b,d).
 *
 * Components must not read probabilities from any other path: the source label
 * rendered next to a result and the probability fed into the evaluate functions
 * both come from the same SelectedProb object, so they can never drift apart.
 *
 * Decision #6: no Pinnacle market => 'unavailable' in EVERY mode (no EV).
 */
import { TOTALS_GRID_MIN, TOTALS_GRID_MAX } from './constants';
import type { ModelTotalsGridEntry, ValueMarketResponse } from './types';

export type ProbMode = 'market' | 'model';

export type SelectedProb =
  | { kind: 'binary'; source: ProbMode; p: number }
  | { kind: 'push'; source: 'model'; pWin: number; pPush: number }
  | { kind: 'quarter'; source: 'model'; lo: [number, number]; hi: [number, number] }
  | { kind: 'unavailable'; source: ProbMode; reason: 'no-market' | 'no-model' | 'line-out-of-range' };

const EPS = 1e-9;

function gridEntry(grid: ModelTotalsGridEntry[], point: number): ModelTotalsGridEntry | null {
  return grid.find((g) => Math.abs(g.point - point) < EPS) ?? null;
}

function isQuarterStep(point: number): boolean {
  return Math.abs(point * 4 - Math.round(point * 4)) < EPS;
}

function winPush(e: ModelTotalsGridEntry, outcome: string): [number, number] {
  return outcome === 'over' ? [e.p_over, e.p_push] : [e.p_under, e.p_push];
}

export function selectProb(
  mode: ProbMode,
  data: ValueMarketResponse,
  userPoint: number | null, // totals only; null for h2h
): SelectedProb {
  if (!data.market_available || data.pinnacle_novig === null) {
    return { kind: 'unavailable', source: mode, reason: 'no-market' };
  }
  if (mode === 'market') {
    return { kind: 'binary', source: 'market', p: data.pinnacle_novig };
  }

  if (data.market === 'h2h') {
    const m = data.model_h2h;
    if (!m) return { kind: 'unavailable', source: 'model', reason: 'no-model' };
    const p = { home: m.p_home, draw: m.p_draw, away: m.p_away }[data.outcome];
    if (p === undefined) return { kind: 'unavailable', source: 'model', reason: 'no-model' };
    return { kind: 'binary', source: 'model', p };
  }

  // totals, model mode: any 0.25-step line within the grid (no line_mismatch — P6 §3.3)
  const grid = data.model_totals_grid;
  if (!grid || grid.length === 0) return { kind: 'unavailable', source: 'model', reason: 'no-model' };
  if (
    userPoint === null ||
    Number.isNaN(userPoint) ||
    !isQuarterStep(userPoint) ||
    userPoint < TOTALS_GRID_MIN - EPS ||
    userPoint > TOTALS_GRID_MAX + EPS
  ) {
    return { kind: 'unavailable', source: 'model', reason: 'line-out-of-range' };
  }
  const isQuarter = Math.abs(userPoint * 2 - Math.round(userPoint * 2)) > EPS;
  if (!isQuarter) {
    const e = gridEntry(grid, userPoint);
    if (!e) return { kind: 'unavailable', source: 'model', reason: 'line-out-of-range' };
    const [pWin, pPush] = winPush(e, data.outcome);
    return { kind: 'push', source: 'model', pWin, pPush };
  }
  const lo = gridEntry(grid, userPoint - 0.25);
  const hi = gridEntry(grid, userPoint + 0.25);
  if (!lo || !hi) return { kind: 'unavailable', source: 'model', reason: 'line-out-of-range' };
  return { kind: 'quarter', source: 'model', lo: winPush(lo, data.outcome), hi: winPush(hi, data.outcome) };
}

/** Fair win probability implied by the selection (display only). For push kinds this is
 * the push-conditioned probability — consistent with breakeven = 1/d (push refunds). */
export function fairProb(sel: SelectedProb): number | null {
  switch (sel.kind) {
    case 'binary':
      return sel.p;
    case 'push': {
      const pLose = Math.max(1 - sel.pWin - sel.pPush, 0);
      return sel.pWin + pLose <= 0 ? null : sel.pWin / (sel.pWin + pLose);
    }
    case 'quarter': {
      const f = (c: [number, number]) => {
        const pLose = Math.max(1 - c[0] - c[1], 0);
        return c[0] + pLose <= 0 ? 0 : c[0] / (c[0] + pLose);
      };
      return 0.5 * f(sel.lo) + 0.5 * f(sel.hi);
    }
    default:
      return null;
  }
}
