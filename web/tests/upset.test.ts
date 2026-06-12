import { describe, it, expect } from 'vitest';
import { computeUpset } from '../lib/upset';

// TU13: tiered upset — cascade A+ → A → B; first match wins.

describe('computeUpset (TU13 — tiered)', () => {
  it('flags A+ when gap ≥ 250 and underdog not-lose ≥ 0.35', () => {
    const r = computeUpset({
      homeTeam: 'A',
      awayTeam: 'B',
      eloHome: 1550,
      eloAway: 1850, // gap 300 ≥ 250; home is weaker
      pHome: 0.15,
      pDraw: 0.25, // weaker not-lose = 0.40 ≥ 0.35
      pAway: 0.60,
    });
    expect(r.tier).toBe('A+');
    expect(r.weaker).toBe('A');
  });

  it('flags A when gap ≥ 200 (but < 250) and underdog not-lose ≥ 0.35', () => {
    const r = computeUpset({
      homeTeam: 'A',
      awayTeam: 'B',
      eloHome: 1600,
      eloAway: 1820, // gap 220; home is weaker
      pHome: 0.20,
      pDraw: 0.25, // weaker not-lose = 0.45 ≥ 0.35
      pAway: 0.55,
    });
    expect(r.tier).toBe('A');
    expect(r.weaker).toBe('A');
  });

  it('flags B when gap ≥ 150 (but < 200) and underdog not-lose ≥ 0.40', () => {
    const r = computeUpset({
      homeTeam: 'A',
      awayTeam: 'B',
      eloHome: 1650,
      eloAway: 1810, // gap 160; home is weaker
      pHome: 0.25,
      pDraw: 0.25, // weaker not-lose = 0.50 ≥ 0.40
      pAway: 0.50,
    });
    expect(r.tier).toBe('B');
    expect(r.weaker).toBe('A');
  });

  it('does not flag when gap ≥ 150 but not-lose below B threshold 0.40', () => {
    const r = computeUpset({
      homeTeam: 'A',
      awayTeam: 'B',
      eloHome: 1650,
      eloAway: 1810, // gap 160 ≥ 150
      pHome: 0.10,
      pDraw: 0.15, // weaker not-lose = 0.25 < 0.40
      pAway: 0.75,
    });
    expect(r.tier).toBeNull();
    expect(r.weaker).toBe('A'); // weaker still identified
  });

  it('does not flag when Elo gap below 150', () => {
    const r = computeUpset({
      homeTeam: 'A',
      awayTeam: 'B',
      eloHome: 1700,
      eloAway: 1750, // gap 50 < 150
      pHome: 0.4,
      pDraw: 0.3,
      pAway: 0.3,
    });
    expect(r.tier).toBeNull();
    expect(r.weaker).toBeNull();
  });

  it('does not flag when gap ≥ 250 but not-lose below A+ threshold 0.35', () => {
    const r = computeUpset({
      homeTeam: 'A',
      awayTeam: 'B',
      eloHome: 1500,
      eloAway: 1800, // gap 300 ≥ 250
      pHome: 0.1,
      pDraw: 0.15, // weaker not-lose = 0.25 < 0.35 (also < 0.40)
      pAway: 0.75,
    });
    expect(r.tier).toBeNull();
    expect(r.weaker).toBe('A');
  });

  it('identifies the away team as weaker when away Elo lower', () => {
    const r = computeUpset({
      homeTeam: 'A',
      awayTeam: 'B',
      eloHome: 1900,
      eloAway: 1700, // away weaker; gap 200
      pHome: 0.55,
      pDraw: 0.25,
      pAway: 0.20, // away not-lose = 0.45 ≥ 0.35
    });
    expect(r.tier).toBe('A');
    expect(r.weaker).toBe('B');
  });

  it('A+ takes priority when both A+ and A could match', () => {
    // gap 300 matches both A+ (≥250) and A (≥200) — A+ should win
    const r = computeUpset({
      homeTeam: 'A',
      awayTeam: 'B',
      eloHome: 1600,
      eloAway: 1900,
      pHome: 0.25,
      pDraw: 0.25,
      pAway: 0.50,
    });
    expect(r.tier).toBe('A+');
  });

  it('respects custom tier overrides', () => {
    const r = computeUpset(
      {
        homeTeam: 'A',
        awayTeam: 'B',
        eloHome: 1600,
        eloAway: 1800, // gap 200
        pHome: 0.25,
        pDraw: 0.25,
        pAway: 0.50,
      },
      [{ tier: 'A+', eloGap: 300, prob: 0.30 }], // only one tier, requires gap ≥ 300
    );
    expect(r.tier).toBeNull(); // gap 200 < 300
  });
});
