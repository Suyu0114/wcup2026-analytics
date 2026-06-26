-- P14 incremental DDL — full-tournament knockout Monte Carlo outputs.
-- Apply ONCE in the Supabase SQL editor on the existing database, BEFORE running
-- `python -m etl.knockout_sim` (same flow as p6/p8/p11 migrations).
--
-- These are MODEL outputs (have model_version; experimental; shown apart from the
-- market — knockout outrights aren't in the odds ingest, so trap #7's side-by-side
-- duty does not apply here, same exception as P11 scenarios). Group→R32 uses the
-- faithful FIFA Annex C table (engine/data/annex_c.json); knockout is neutral-site
-- + no-draw (win expectancy). Recomputed per version per round by etl/knockout_sim.py.

-- Per-team round-reach + champion probability ("reach R32" = group_sim.p_advance,
-- not re-stored; this starts at R16).
create table knockout_sim (
  team_id        text not null references teams(team_id),
  group_label    char(1) not null,
  p_make_r16     numeric not null,
  p_make_qf      numeric not null,
  p_make_sf      numeric not null,
  p_make_final   numeric not null,
  p_champion     numeric not null,
  sim_n          int not null,                       -- N simulations (provenance)
  model_version  text not null,                      -- = match_predictions version
  computed_at    timestamptz not null default now(),
  primary key (team_id, model_version)
);

-- Projected matchups: P(team fills a given R32 slot position). Replaced per version
-- each run (etl/db.replace_bracket_slot_sim) — a team that no longer reaches a slot
-- must not leave a stale row.
create table bracket_slot_sim (
  match_no       int not null,                       -- FIFA R32 match number (73..88)
  side           text not null,                      -- 'home' | 'away'
  team_id        text not null references teams(team_id),
  prob           numeric not null,                   -- P(this team occupies this slot)
  sim_n          int not null,
  model_version  text not null,
  computed_at    timestamptz not null default now(),
  primary key (match_no, side, team_id, model_version)
);
create index bracket_slot_sim_lookup on bracket_slot_sim (model_version, match_no, side);
