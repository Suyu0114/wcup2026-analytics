/**
 * Market/model verdict presentation helpers (P6 §3.2 / TB4). Presentation only:
 * the arithmetic definition of value stays EV > 0 (engine/value.py parity).
 */
import { NEAR_FAIR_EV } from './constants';

export type VerdictTier = 'good' | 'nearFair' | 'expensive';

export function verdictTier(ev: number, nearFairEv: number = NEAR_FAIR_EV): VerdictTier {
  if (ev > 0) return 'good';
  if (ev >= nearFairEv) return 'nearFair';
  return 'expensive';
}

/** "每注 100 平均賺/虧 Y" — signed amount per 100 staked. */
export function per100(ev: number): number {
  return ev * 100;
}

/** Breakeven win rate of the bet (push-refund consistent): 1/d. */
export function breakeven(decimalOdds: number): number {
  return 1 / decimalOdds;
}
