"""Curated, hand-verified match results (matchday fallback).

football-data's matchday data is unreliable on the free tier (verified 2026-06-11:
match 537327 flapped FINISHED→TIMED with score.fullTime = null throughout — lag /
the free competition tier may withhold goals). So an entry here is AUTHORITATIVE:
ingest_fixtures settles the match from this table regardless of fd's status, and a
*conflicting* non-null fd score fails loud (verify-don't-assume). With no entry, a
fd FINISHED-without-score is left UNSETTLED (not promoted to 'final' without a
score — data integrity over approximation). Remove an entry once fd reliably
serves the same score, if you want fd to own it again.

When fd serves a *wrong* non-null score (not null — actually wrong; verified
2026-06-21: match 537371 Spain v Saudi Arabia, fd 5-0 vs actual 4-0), the conflict
guard would block the whole ingest. The escape hatch lives on the DB row, not here:
set manual_results.override_fd=true (P12, or tick the admin "fd 比分有誤" box) so the
curated score wins over fd with a loud WARNING instead of a raise.

Provenance: each entry is the official full-time (90'+stoppage, pre-ET/pens)
score, verified by hand against the official record before being added. Add an
entry only for a result you've personally confirmed.

⚠️ home/away follow our stored orientation (= football-data orientation; we never
swap — see the host-away trap in CLAUDE.md / etl/venues.py). So home_goals is the
goals of `matches.home_team`, which for round-3 host games is football-data's home
side, NOT necessarily the host.
"""
from __future__ import annotations

# football-data match_id -> (home_goals, away_goals), hand-verified full-time score.
RESULTS: dict[str, tuple[int, int]] = {
    # Group A, 2026-06-11 — Mexico v South Africa (Estadio Azteca opener).
    # Full-time 2-0 (home Mexico 2, away South Africa 0); fd had a null score at ingest.
    "537327": (2, 0),
}


def result(match_id: str) -> tuple[int, int] | None:
    """Curated (home_goals, away_goals) for a match, or None if not curated."""
    return RESULTS.get(match_id)
