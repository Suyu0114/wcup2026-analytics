-- P6 incremental DDL (docs/P6-spec.md §4 + A1 impl note).
-- Apply ONCE in the Supabase SQL editor on the existing database
-- (the canonical etl/sql/schema.sql already includes all of this for fresh installs).

-- A1: football-data lists the hosts as the AWAY team in their third group games
-- (Switzerland v Canada / Czechia v Mexico / Turkey v United States) — the engine
-- carries that advantage on a separate flag instead of swapping orientation.
alter table matches
  add column if not exists is_host_away boolean not null default false;

-- B3 (P6 §3.4): totals grid + push probability (integer lines only non-zero).
alter table model_total_lines
  add column if not exists model_p_push numeric not null default 0;

-- B4 (P6 §3.5 / §4.2): calibration runs — Kelly unlock gate + model-mode status line.
create table if not exists calibration_runs (
  run_id         bigserial primary key,
  run_at         timestamptz not null default now(),
  model_version  text not null,
  n_settled      int not null,
  model_brier    numeric,           -- null when n_settled = 0
  model_logloss  numeric,
  market_brier   numeric,
  market_logloss numeric
);
create index if not exists calibration_runs_lookup
  on calibration_runs (model_version, run_at desc);
