-- P12 incremental DDL — acknowledge a known-wrong football-data score.
-- Apply ONCE in the Supabase SQL editor on the existing database (idempotent).
--
-- manual_results is the AUTHORITATIVE hand-verified result source (P7). When fd
-- serves a *conflicting non-null* score, ingest_fixtures fails loud by design
-- (verify-don't-assume — usually catches an admin typo). But fd can also just be
-- wrong (verified 2026-06-21: match 537371 Spain v Saudi Arabia — fd reported 5-0,
-- actual full-time 4-0). This flag is the deliberate escape hatch: when true, the
-- curated score wins over a conflicting fd score (ingest logs a loud WARNING with
-- what fd said, but does NOT raise). Default false keeps fail-loud everywhere else.
alter table manual_results
  add column if not exists override_fd boolean not null default false;

comment on column manual_results.override_fd is
  'true = curated score is authoritative even against a conflicting non-null '
  'football-data score (fd is wrong); ingest warns instead of raising. See p12.sql.';
