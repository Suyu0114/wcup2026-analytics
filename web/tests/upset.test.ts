import { describe, it, expect } from 'vitest';
import { computeUpset } from '../lib/upset';

// TU13: |Δelo| >= 150 AND weaker team's (p_win + p_draw) >= 0.40 -> upset flag.

describe('computeUpset (TU13)', () => {
  it('flags when gap large and underdog not-lose prob meaningful', () => {
    const r = computeUpset({
      homeTeam: 'A',
      awayTeam: 'B',
      eloHome: 1600,
      eloAway: 1800, // gap 200 >= 150; home is weaker
      pHome: 0.3,
      pDraw: 0.25, // weaker not-lose = 0.55 >= 0.4
      pAway: 0.45,
    });
    expect(r.flag).toBe(true);
    expect(r.weaker).toBe('A');
  });

  it('does not flag when Elo gap below threshold', () => {
    const r = computeUpset({
      homeTeam: 'A',
      awayTeam: 'B',
      eloHome: 1700,
      eloAway: 1750, // gap 50 < 150
      pHome: 0.4,
      pDraw: 0.3,
      pAway: 0.3,
    });
    expect(r.flag).toBe(false);
    expect(r.weaker).toBeNull();
  });

  it('does not flag when underdog not-lose prob too low', () => {
    const r = computeUpset({
      homeTeam: 'A',
      awayTeam: 'B',
      eloHome: 1500,
      eloAway: 1800, // gap 300; home weaker
      pHome: 0.1,
      pDraw: 0.15, // not-lose = 0.25 < 0.4
      pAway: 0.75,
    });
    expect(r.flag).toBe(false);
    expect(r.weaker).toBe('A');
  });

  it('identifies the away team as weaker when away Elo lower', () => {
    const r = computeUpset({
      homeTeam: 'A',
      awayTeam: 'B',
      eloHome: 1900,
      eloAway: 1700, // away weaker
      pHome: 0.6,
      pDraw: 0.25,
      pAway: 0.15, // away not-lose = 0.40 >= 0.4
    });
    expect(r.flag).toBe(true);
    expect(r.weaker).toBe('B');
  });

  it('respects custom thresholds', () => {
    const r = computeUpset(
      { homeTeam: 'A', awayTeam: 'B', eloHome: 1600, eloAway: 1750, pHome: 0.3, pDraw: 0.25, pAway: 0.45 },
      200, // require gap >= 200; actual 150 -> no flag
    );
    expect(r.flag).toBe(false);
  });
});
