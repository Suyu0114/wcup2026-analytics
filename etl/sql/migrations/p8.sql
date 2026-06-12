-- P8 incremental DDL — FIFA-style group standings table.
-- Apply ONCE in the Supabase SQL editor on the existing database, then run
-- `python -m etl.standings` (and add it to the matchday recompute pipeline).
--
-- This is the ACTUAL standings table (Played / W / D / L / GF / GA / GD / Pts),
-- computed from finished group matches by etl/standings.py — distinct from
-- `group_sim`, which holds Monte Carlo advancement PROBABILITIES.
--
-- It is a FACT derived from results, not a model output → NO model_version
-- (one canonical row per team; team_id is the PK). Idempotent upsert.
-- Rank tiebreaker is the DISPLAY rule: Pts→GD→GF→head-to-head, then `tied=true`
-- (we do not invent Elo/fair-play/lots; see engine/standings.py).
create table if not exists group_standings (
  team_id      text primary key references teams(team_id),
  group_label  char(1) not null,                   -- 'A'..'L'
  played       int not null default 0,
  wins         int not null default 0,
  draws        int not null default 0,
  losses       int not null default 0,
  gf           int not null default 0,             -- goals for
  ga           int not null default 0,             -- goals against
  gd           int not null default 0,             -- = gf - ga (denormalized for ordering)
  pts          int not null default 0,
  rank         int not null,                        -- 1-based position within group
  tied         boolean not null default false,      -- unresolved level with an adjacent team
  computed_at  timestamptz not null default now()   -- provenance
);
create index if not exists group_standings_group on group_standings (group_label, rank);
