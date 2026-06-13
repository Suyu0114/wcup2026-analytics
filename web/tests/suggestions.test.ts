import { describe, it, expect } from 'vitest';
import { computeRiskTiers } from '../lib/suggestions';

// Market-only risk tiers (featured card). Headline cases use the real de-vig
// numbers from the 2026-06-12 snapshot.

describe('computeRiskTiers', () => {
  it('home favourite (USA v Paraguay): steady=1X, medium=home win, risky=away win', () => {
    const tiers = computeRiskTiers({ home: 0.457, draw: 0.296, away: 0.247 }, null);
    expect(tiers).not.toBeNull();
    expect(tiers!.steady).toEqual({ kind: 'dc_home', p: expect.closeTo(0.753, 10) });
    expect(tiers!.medium).toEqual({ kind: 'home', p: 0.457 });
    expect(tiers!.risky).toEqual({ kind: 'away', p: 0.247 });
    expect(tiers!.totals).toBeNull();
  });

  it('away favourite (Qatar v Switzerland): steady=X2, medium=away win, risky=home win', () => {
    const tiers = computeRiskTiers({ home: 0.064, draw: 0.138, away: 0.798 }, null);
    expect(tiers!.steady).toEqual({ kind: 'dc_away', p: expect.closeTo(0.936, 10) });
    expect(tiers!.medium).toEqual({ kind: 'away', p: 0.798 });
    expect(tiers!.risky).toEqual({ kind: 'home', p: 0.064 });
  });

  it('totals: picks the favoured side of the main line, carrying the point', () => {
    const novig = { home: 0.5, draw: 0.3, away: 0.2 };
    expect(computeRiskTiers(novig, { point: 2.5, over: 0.55, under: 0.45 })!.totals).toEqual({
      kind: 'over',
      p: 0.55,
      point: 2.5,
    });
    expect(computeRiskTiers(novig, { point: 3.0, over: 0.41, under: 0.59 })!.totals).toEqual({
      kind: 'under',
      p: 0.59,
      point: 3.0,
    });
  });

  it('exact home/away tie prefers home (matches argmax tie-break culture)', () => {
    const tiers = computeRiskTiers({ home: 0.35, draw: 0.3, away: 0.35 }, null);
    expect(tiers!.medium.kind).toBe('home');
    expect(tiers!.risky.kind).toBe('away');
  });

  it('no market → null (no tiers in any mode, like "no Pinnacle → no EV")', () => {
    expect(computeRiskTiers(null, { point: 2.5, over: 0.5, under: 0.5 })).toBeNull();
  });
});
