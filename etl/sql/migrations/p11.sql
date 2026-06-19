-- P11 incremental DDL — group-stage qualification scenario analysis.
-- Apply ONCE in the Supabase SQL editor on the existing database, then run
-- `python -m etl.scenarios` (and add it to the matchday recompute pipeline,
-- after `python -m etl.standings`).
--
-- For every not-yet-final group match, this holds what each of W/D/L does to the
-- two teams' qualification status (engine/scenarios.py). It is a deterministic
-- FACT (no model, no Elo, no randomness — cf. group_standings) → NO model_version.
-- Cross-group best-third safety is NOT decided here (v1-lean, spec §6); such teams
-- stay `alive` with needs_best_third=true and the frontend overlays the (separate,
-- experimental) group_sim probability.
--
-- Grain = (match_id, outcome, team_id): the "W/D/L × the two teams" matrix.
-- Match-level flags are denormalized onto every row of a match (identical per match).
-- The job does a full delete-all + insert each run (rows for a match disappear once
-- it goes final), so the table NEVER holds a final match's rows (spec §8.2).
create table if not exists group_scenarios (
  match_id              text not null references matches(match_id),
  group_label           char(1) not null,            -- 'A'..'L'
  outcome               text not null,               -- 'home' | 'draw' | 'away' (THIS match's result)
  team_id               text not null references teams(team_id),
  status                text not null,               -- top2_clinched | advance_clinched | eliminated | alive
  can_win_group         boolean not null,
  secured_3rd_or_better boolean not null,
  needs_best_third      boolean not null,
  seeding_live          boolean not null,            -- clinched top-2 but 1st-vs-2nd not pinned
  basis_key             text not null,               -- structured i18n key (translated in the frontend)
  convenience_draw      boolean not null,            -- match-level (denormalized): draw locks both into top-2
  convenience_draw_kind text,                         -- 'top2' | 'mutual_3rd_conditional' | null
  dead_rubber           boolean not null,            -- match-level: result changes nothing (qual AND seeding)
  computed_at           timestamptz not null default now(),
  primary key (match_id, outcome, team_id)
);
create index if not exists group_scenarios_group on group_scenarios (group_label);
