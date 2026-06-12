-- P7 incremental DDL — manual match-result overrides (admin entry).
-- Apply ONCE in the Supabase SQL editor on the existing database.
--
-- football-data's matchday data is unreliable on the free tier (a match can read
-- FINISHED with a null score, and the status flaps). This table is the AUTHORITATIVE
-- hand-verified result source: the admin page upserts a row here, and
-- etl/ingest_fixtures.py reads it (DB-first, code dict etl/results.py as fallback
-- seed) to settle the match. One curated result per match → match_id is the PK.
create table if not exists manual_results (
  match_id    text primary key references matches(match_id),
  home_goals  int not null,
  away_goals  int not null,
  entered_by  text,                              -- admin identifier (provenance/audit)
  entered_at  timestamptz not null default now(),
  note        text
);
