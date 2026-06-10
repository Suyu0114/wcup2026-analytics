// Shared constants (spec §4 / §6.3).

// Active model version — bump together with engine.dixon_coles.MODEL_VERSION (P6 TA5).
export const MODEL_VERSION = 'dc-v1.1';

// Upset rule thresholds (P1 §5.4 / spec §6.3) — adjustable, not hardcoded in the engine.
export const UPSET_ELO_GAP = 150;
export const UPSET_PROB = 0.4;

// Odds freshness window (spec §4.4): older than this → flagged stale.
export const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

// The sharp de-vig benchmark (P3 decision #4).
export const PINNACLE = 'pinnacle';

// P6 §3.2: market-mode verdict tiers. 🟡 threshold = better than a typical
// mainstream book's one-sided vig. Presentation only — is_value stays EV>0.
export const NEAR_FAIR_EV = -0.025;

// P6 §3.5: model-mode Kelly unlock gate (judged server-side from calibration_runs).
export const KELLY_UNLOCK_N = 30;
export const KELLY_UNLOCK_BRIER_RATIO = 1.1;

// P6 §3.4: model totals grid bounds (0.25 step).
export const TOTALS_GRID_MIN = 1.5;
export const TOTALS_GRID_MAX = 4.5;
