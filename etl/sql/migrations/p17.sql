-- P17: real knockout bracket linkage + knockout result semantics.
-- Apply in the Supabase SQL editor BEFORE deploying the P17 code (ingest writes
-- these columns; web selects them). Additive + nullable → old code keeps working.

-- FIFA match number 73..104 (engine/bracket.py slot key). Resolved at ingest from
-- the kickoff-keyed schedule (etl/venues.py KNOCKOUT_SCHEDULE); null for group stage.
-- unique: match_no is a deterministic function of the fixed kickoff slot, so
-- idempotent re-ingests rewrite the same value (validated pre-DB in ingest_fixtures).
alter table matches add column match_no int unique
  check (match_no between 73 and 104);

-- fd score.winner ('home'/'away'), recorded only when status='final'. Needed because
-- a knockout match decided on penalties stores LEVEL fullTime goals — the winner is
-- not derivable from the score. Null for group stage, unsettled, and manual-settled
-- rows without fd confirmation (the sim then falls back to downstream inference).
alter table matches add column winner text
  check (winner in ('home','away'));

-- fd score.duration: how the match ended. 'et'/'pk' means regulation ended level
-- (calibrate scores those as a 90-minute draw against 1X2 markets — P17 honesty fix).
alter table matches add column result_duration text
  check (result_duration in ('regular','et','pk'));
