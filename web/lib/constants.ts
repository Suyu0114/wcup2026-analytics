// Shared constants (spec §4 / §6.3).

export const MODEL_VERSION = 'dc-v1.0';

// Upset rule thresholds (P1 §5.4 / spec §6.3) — adjustable, not hardcoded in the engine.
export const UPSET_ELO_GAP = 150;
export const UPSET_PROB = 0.4;

// Odds freshness window (spec §4.4): older than this → flagged stale.
export const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

// The sharp de-vig benchmark (P3 decision #4).
export const PINNACLE = 'pinnacle';
