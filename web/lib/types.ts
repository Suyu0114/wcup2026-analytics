// Shared API/view types (spec §4). model and market are kept in separate objects so the
// frontend can never mix them into the value path (D5 / TU6).

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
  p_home: number;
  p_draw: number;
  p_away: number;
  p_over_2_5: number;
  p_btts: number | null;
  exp_total_goals: number;
  upset: { flag: boolean; weaker: string | null };
}

export interface MatchMarket {
  pinnacle_novig: { home: number; draw: number; away: number } | null;
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

export interface ValueMarketResponse {
  match_id: string;
  market: 'h2h' | 'totals';
  outcome: string;
  market_available: boolean; // false → no odds; frontend shows model only, no value (§6.1)
  pinnacle_main_point: number | null; // totals only (P3 §2 main line)
  pinnacle_novig: number | null; // de-vig prob for `outcome`; value path consumes ONLY this
  is_quarter_line: boolean | null;
  best_available: BookPrice | null; // best price on the SAME line (TV7)
  line_shopping: BookPrice[];
  model_layer: {
    model_version: string;
    point: number;
    p_over: number;
    p_under: number;
  } | null; // experimental, isolated from value (P3 §5.4 / TV5)
  freshness: Freshness | null;
}

export interface FreshnessSummary {
  elo_asof: string | null;
  odds_captured_at: string | null;
  sim_computed_at: string | null;
  unavailable: boolean;
}
