// Shared API/view types (spec §4). model and market are kept in separate objects so the
// frontend can never mix them into the value path (D5 / TU6).
import type { Outcome } from './divergence';
import type { UpsetTier } from './constants';

export interface TeamRef {
  team_id: string;
  name_en: string;
  name_zh: string | null;
  elo: number;
}

export interface BookPrice {
  book: string;
  decimal: number;
}

export interface H2HBest {
  home: BookPrice | null;
  draw: BookPrice | null;
  away: BookPrice | null;
}

export interface Freshness {
  captured_at: string | null;
  last_update: string | null;
  stale: boolean;
}

export interface MatchModel {
  model_version: string;
  lambda_home: number;
  lambda_away: number;
  p_home: number;
  p_draw: number;
  p_away: number;
  p_over_2_5: number;
  p_btts: number | null;
  exp_total_goals: number;
  upset: { tier: 'A+' | 'A' | 'B' | null; weaker: string | null };
}

export interface MatchMarket {
  pinnacle_novig: { home: number; draw: number; away: number } | null;
  // Pinnacle totals main line, de-vig'd (featured-card risk tiers / display).
  totals: { point: number; over: number; under: number } | null;
  best_h2h: H2HBest | null;
  freshness: Freshness | null;
}

export interface MatchView {
  match_id: string;
  stage: string;
  group_label: string | null;
  kickoff_utc: string;
  status: string;
  home: TeamRef;
  away: TeamRef;
  model: MatchModel | null; // experimental; never a standalone answer (D5)
  market: MatchMarket | null; // null when no odds posted yet (graceful, §6.1)
  // Cross-comparison: model vs market most-likely outcome. null when either side missing.
  // Display-only "they disagree" signal — never a value signal (divergence.ts).
  divergence: { flag: boolean; modelPick: Outcome; marketPick: Outcome } | null;
}

export interface MatchesResponse {
  matches: MatchView[];
  unavailable: boolean; // true when DB creds/connection unavailable (graceful, §6.6)
}

export interface GroupTeam {
  team_id: string;
  name_en: string;
  name_zh: string | null;
  p_first: number;
  p_second: number;
  p_third_qual: number;
  p_advance: number;
}

export interface GroupsResponse {
  model_version: string | null;
  sim_n: number | null;
  computed_at: string | null;
  groups: Record<string, GroupTeam[]>;
  unavailable: boolean;
}

// P6 §3.5: latest calibration_runs row; kelly_unlocked is judged SERVER-side.
export interface CalibrationStatus {
  model_version: string;
  run_at: string;
  n_settled: number;
  model_brier: number | null;
  market_brier: number | null;
  kelly_unlocked: boolean;
}

export interface ModelTotalsGridEntry {
  point: number;
  p_over: number;
  p_under: number;
  p_push: number;
}

export interface ValueMarketResponse {
  match_id: string;
  market: 'h2h' | 'totals';
  outcome: string;
  market_available: boolean; // false → no odds; no EV in ANY mode (P6 §1.6)
  pinnacle_main_point: number | null; // totals only (P3 §2 main line)
  pinnacle_novig: number | null; // de-vig prob for `outcome`; market mode consumes ONLY this
  is_quarter_line: boolean | null;
  best_available: BookPrice | null; // best price on the SAME line (TV7)
  line_shopping: BookPrice[];
  // --- model side (P6 §5) — consumed only when the user opts into model mode ---
  model_h2h: {
    model_version: string;
    p_home: number;
    p_draw: number;
    p_away: number;
  } | null;
  model_totals_grid: ModelTotalsGridEntry[] | null; // 1.5–4.5 grid (replaces model_layer)
  calibration: CalibrationStatus | null; // null → treat as locked
  freshness: Freshness | null;
}

export interface FreshnessSummary {
  elo_asof: string | null;
  odds_captured_at: string | null;
  sim_computed_at: string | null;
  unavailable: boolean;
}

// P8 — fixtures & results (facts; decoupled from model/odds). All stages fetched so
// the UI can switch on `stage` (group rows vs knockout-TBD placeholder).
export interface FixtureView {
  match_id: string;
  stage: string;
  group_label: string | null;
  kickoff_utc: string;
  status: string; // 'scheduled' | 'live' | 'final'
  home: TeamRef;
  away: TeamRef;
  home_goals: number | null; // null until the match is played/settled
  away_goals: number | null;
}

export interface FixturesResponse {
  fixtures: FixtureView[];
  unavailable: boolean;
}

// P8 — actual group standings (a FACT computed from results, not a model output;
// no model_version). Display tiebreaker Pts→GD→GF→H2H, then `tied` (engine/standings.py).
export interface StandingRow {
  team_id: string;
  name_en: string;
  name_zh: string | null;
  group_label: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  rank: number;
  tied: boolean; // unresolved level with an adjacent team (footnote-worthy)
}

export interface StandingsResponse {
  groups: Record<string, StandingRow[]>;
  computed_at: string | null;
  unavailable: boolean;
}

// P9 — prediction track record. Settled group matches scored against actual results.
// Predictions are the frozen pre-tournament model (predict is NOT re-run per match — see
// docs/manual-commands.md / docs/P9-spec.md §2), so these reproduce the PRE-MATCH prediction
// and the SAME upset tag the featured card showed. Model is always shown alongside the market
// (trap #7); the upset tag's `result` leads the "did it actually upset" read.
export interface TrackRecordSide {
  p_home: number;
  p_draw: number;
  p_away: number;
  pick: Outcome; // argmax (argmaxOutcome)
  hit: boolean; // pick === actual outcome
  brier: number;
}

export interface TrackRecordRow {
  match_id: string;
  stage: string;
  group_label: string | null;
  kickoff_utc: string;
  home: TeamRef;
  away: TeamRef;
  home_goals: number;
  away_goals: number;
  actual: Outcome;
  model: TrackRecordSide;
  market: TrackRecordSide | null; // null when no Pinnacle de-vig (counted in model n, not market n)
  // present only when the match was TAGGED upset-risk (computeUpset tier !== null)
  upset: { tier: UpsetTier; weaker: string; result: 'won' | 'drew' | 'lost' } | null;
}

export interface TrackRecordTierStat {
  total: number;
  notLost: number; // weaker won or drew
  won: number;
}

export interface TrackRecordSummary {
  // aggregate pick accuracy + mean Brier; market on its own (smaller) n, mirroring calibrate.py
  model: { n: number; correct: number; brier: number } | null;
  market: { n: number; correct: number; brier: number } | null;
  upset: {
    total: number;
    notLost: number;
    won: number;
    byTier: Record<UpsetTier, TrackRecordTierStat>;
  };
}

export interface TrackRecordResponse {
  rows: TrackRecordRow[]; // most-recent first
  summary: TrackRecordSummary;
  unavailable: boolean;
}

// P11 — qualification scenario analysis. For every not-yet-final group match, what each
// of W/D/L does to the two teams' qualification status. A deterministic FACT (no
// model_version). Cross-group best-third safety is NOT decided here (v1-lean); such teams
// stay `alive`/needs_best_third and the frontend overlays the separate, experimental
// group_sim probability (spec §7). status ∈ top2_clinched|advance_clinched|eliminated|alive.
export interface TeamOutcomeView {
  team_id: string;
  name_en: string;
  name_zh: string | null;
  status: string;
  can_win_group: boolean;
  secured_3rd_or_better: boolean;
  needs_best_third: boolean;
  seeding_live: boolean; // clinched top-2 but 1st-vs-2nd not pinned ([A])
  basis_key: string; // structured i18n key (scenarios.basis_<key>)
}

export interface MatchScenarioView {
  match_id: string;
  group_label: string;
  kickoff_utc: string;
  home: TeamRef;
  away: TeamRef;
  // outcome → [home-team outcome, away-team outcome]
  outcomes: Record<'home' | 'draw' | 'away', [TeamOutcomeView, TeamOutcomeView]>;
  convenience_draw: boolean; // draw locks both into top-2 (strong, Gijón-style)
  convenience_draw_kind: string | null; // 'top2' | 'mutual_3rd_conditional' | null
  dead_rubber: boolean; // result changes nothing (qualification AND seeding) ([A])
}

export interface ScenariosResponse {
  groups: Record<string, MatchScenarioView[]>;
  computed_at: string | null;
  unavailable: boolean;
}

// P14 — full-tournament knockout Monte Carlo. MODEL output (experimental; no market to
// pair with — knockout outrights aren't ingested, trap #7 exception as in P11). "reach
// R32" = group_sim.p_advance (not re-stored); these start at R16.
export interface KnockoutTeam {
  team_id: string;
  name_en: string;
  name_zh: string | null;
  group_label: string;
  p_make_r16: number;
  p_make_qf: number;
  p_make_sf: number;
  p_make_final: number;
  p_champion: number;
}

export interface KnockoutSimResponse {
  teams: KnockoutTeam[]; // sorted by p_champion desc
  sim_n: number | null;
  computed_at: string | null;
  unavailable: boolean;
}

// Projected matchups: the most-likely occupant of each R32 slot position.
export interface BracketSlotTeam {
  match_no: number;
  side: 'home' | 'away';
  team_id: string;
  name_en: string;
  name_zh: string | null;
  prob: number;
}

export interface BracketSlotsResponse {
  slots: BracketSlotTeam[]; // top occupant per (match_no, side)
  unavailable: boolean;
}
