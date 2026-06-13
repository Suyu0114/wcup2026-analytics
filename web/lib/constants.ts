// Shared constants (spec §4 / §6.3).

// Active model version — bump together with engine.dixon_coles.MODEL_VERSION (P6 TA5).
export const MODEL_VERSION = 'dc-v1.1';

// Tiered upset thresholds (P1 §5.4 / spec §6.3) — cascade A+ → A → B (first match wins).
// Adjustable, not hardcoded in the engine. Calibrated for dc-v1.1 fitted params.
export type UpsetTier = 'A+' | 'A' | 'B';
export const UPSET_TIERS: readonly { tier: UpsetTier; eloGap: number; prob: number }[] = [
  { tier: 'A+', eloGap: 250, prob: 0.35 },
  { tier: 'A',  eloGap: 200, prob: 0.35 },
  { tier: 'B',  eloGap: 150, prob: 0.40 },
];

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

// Home-page featured cards. Display-only mirrors of backend constants:
// HFA_ELO mirrors engine.dixon_coles.HFA_ELO (bump together, like MODEL_VERSION);
// HOST_NATIONS mirrors etl/venues.HOST_TEAMS (Elo two-letter codes).
export const HFA_ELO = 84.5;
export const HOST_NATIONS: ReadonlySet<string> = new Set(['US', 'CA', 'MX']);
export const FEATURED_COUNT = 3;

// Scoreline hint (lib/scorelines.ts): mirrors of engine.dixon_coles RHO / MAXG —
// bump together with the engine, and regenerate scoreline_vectors.json
// (python web/tests/fixtures/gen_scorelines.py) to keep parity.
export const DC_RHO = -0.12;
export const SCORE_MATRIX_MAXG = 10;
