import { describe, it, expect } from 'vitest';
import { result1x2, brier, classifyUpset } from '../lib/score';
import { argmaxOutcome } from '../lib/divergence';

// P9 — result scoring parity with etl/calibrate.py (result_1x2 / brier) + upset materialisation.

describe('result1x2', () => {
  it('maps scores to 1X2 outcomes', () => {
    expect(result1x2(2, 0)).toBe('home');
    expect(result1x2(0, 1)).toBe('away');
    expect(result1x2(1, 1)).toBe('draw');
    expect(result1x2(0, 0)).toBe('draw');
  });
});

describe('brier', () => {
  it('is 0 for a perfect certain prediction', () => {
    expect(brier({ home: 1, draw: 0, away: 0 }, 'home')).toBe(0);
  });

  it('matches the calibrate.py formula sum((p - y)^2)', () => {
    // p=(0.5,0.3,0.2), outcome=home → (0.5-1)^2 + 0.3^2 + 0.2^2 = 0.25+0.09+0.04 = 0.38
    expect(brier({ home: 0.5, draw: 0.3, away: 0.2 }, 'home')).toBeCloseTo(0.38, 10);
    // same probs, outcome=away → 0.5^2 + 0.3^2 + (0.2-1)^2 = 0.25+0.09+0.64 = 0.98
    expect(brier({ home: 0.5, draw: 0.3, away: 0.2 }, 'away')).toBeCloseTo(0.98, 10);
  });

  it('uniform guess scores 2/3 regardless of outcome', () => {
    const u = { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
    expect(brier(u, 'home')).toBeCloseTo(2 / 3, 10);
    expect(brier(u, 'draw')).toBeCloseTo(2 / 3, 10);
  });
});

describe('pick = argmaxOutcome (reused, no drift)', () => {
  it('picks the most-likely outcome', () => {
    expect(argmaxOutcome({ home: 0.5, draw: 0.3, away: 0.2 })).toBe('home');
    expect(argmaxOutcome({ home: 0.2, draw: 0.5, away: 0.3 })).toBe('draw');
    expect(argmaxOutcome({ home: 0.2, draw: 0.3, away: 0.5 })).toBe('away');
  });
});

describe('classifyUpset — did the weaker (lower-Elo) team avoid losing?', () => {
  it('weaker = home: classifies from the home perspective', () => {
    expect(classifyUpset('US', 'US', 2, 0)).toBe('won'); // US (home, weaker) wins
    expect(classifyUpset('US', 'US', 1, 1)).toBe('drew');
    expect(classifyUpset('US', 'US', 0, 3)).toBe('lost');
  });

  it('weaker = away: classifies from the away perspective', () => {
    // home_team = BR, weaker = away (XX). XX goals = away_goals.
    expect(classifyUpset('XX', 'BR', 0, 2)).toBe('won'); // XX (away, weaker) wins
    expect(classifyUpset('XX', 'BR', 1, 1)).toBe('drew');
    expect(classifyUpset('XX', 'BR', 3, 0)).toBe('lost');
  });

  it('won and drew both count as not-lost (the tier basis)', () => {
    const notLost = (r: 'won' | 'drew' | 'lost') => r !== 'lost';
    expect(notLost(classifyUpset('US', 'US', 2, 0))).toBe(true);
    expect(notLost(classifyUpset('US', 'US', 1, 1))).toBe(true);
    expect(notLost(classifyUpset('US', 'US', 0, 1))).toBe(false);
  });
});
