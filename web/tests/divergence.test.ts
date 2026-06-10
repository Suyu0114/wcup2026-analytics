import { describe, it, expect } from 'vitest';
import { computeDivergence, argmaxOutcome } from '../lib/divergence';

// Argmax-flip rule: model's most-likely 1X2 outcome differs from the market's -> flag.
// Real cards from the 2026-06-09 odds snapshot drive the two headline cases.

describe('computeDivergence', () => {
  it('flags when model and market pick different outcomes (USA vs Paraguay)', () => {
    // model favours away (Paraguay); market favours home (USA) -> argmax flip
    const r = computeDivergence(
      { home: 0.217, draw: 0.259, away: 0.524 },
      { home: 0.483, draw: 0.276, away: 0.241 },
    );
    expect(r).not.toBeNull();
    expect(r!.flag).toBe(true);
    expect(r!.modelPick).toBe('away');
    expect(r!.marketPick).toBe('home');
  });

  it('does not flag same-direction disagreement (Brazil vs Morocco)', () => {
    // both favour home; only the magnitude differs -> no flag
    const r = computeDivergence(
      { home: 0.598, draw: 0.236, away: 0.166 },
      { home: 0.571, draw: 0.258, away: 0.172 },
    );
    expect(r).not.toBeNull();
    expect(r!.flag).toBe(false);
    expect(r!.modelPick).toBe('home');
    expect(r!.marketPick).toBe('home');
  });

  it('returns null when there is no market (nothing to diverge from)', () => {
    expect(computeDivergence({ home: 0.5, draw: 0.25, away: 0.25 }, null)).toBeNull();
  });

  it('flags a draw-vs-home flip', () => {
    const r = computeDivergence(
      { home: 0.3, draw: 0.4, away: 0.3 },
      { home: 0.45, draw: 0.3, away: 0.25 },
    );
    expect(r!.flag).toBe(true);
    expect(r!.modelPick).toBe('draw');
    expect(r!.marketPick).toBe('home');
  });

  it('does not flag near-identical distributions', () => {
    const r = computeDivergence(
      { home: 0.4, draw: 0.35, away: 0.25 },
      { home: 0.41, draw: 0.34, away: 0.25 },
    );
    expect(r!.flag).toBe(false);
  });
});

describe('argmaxOutcome tie-break (home > draw > away)', () => {
  it('prefers home on a home/draw tie', () => {
    expect(argmaxOutcome({ home: 0.4, draw: 0.4, away: 0.2 })).toBe('home');
  });
  it('prefers draw on a draw/away tie', () => {
    expect(argmaxOutcome({ home: 0.2, draw: 0.4, away: 0.4 })).toBe('draw');
  });
});
