"""Elo ingest (P0, spec §4.1): CSV -> validate (T0 gate) -> upsert teams.

    python -m etl.ingest_elo             # validate + load to Supabase
    python -m etl.ingest_elo --dry-run   # validate only, no DB (runs offline)
"""
from __future__ import annotations

import argparse
import math
from datetime import date

from etl import config
from sources.rating_source import CsvRatingSource, Rating

EXPECTED_TEAMS = 48


def validate_teams(ratings: list[Rating], today: date | None = None) -> None:
    """T0 acceptance gate (spec §6). Fail loud on any breach."""
    today = today or date.today()
    n = len(ratings)
    if n != EXPECTED_TEAMS:
        raise ValueError(f"T0: expected {EXPECTED_TEAMS} teams, got {n}")

    ids = [r.team_id for r in ratings]
    if len(set(ids)) != n:
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        raise ValueError(f"T0: team_id not unique; duplicates={dupes}")

    bad_elo = [r.team_id for r in ratings if r.elo is None or math.isnan(r.elo)]
    if bad_elo:
        raise ValueError(f"T0: null/NaN elo for {bad_elo}")

    future = [r.team_id for r in ratings if r.asof > today]
    if future:
        raise ValueError(f"T0: elo_asof in the future for {future} (provenance broken)")


def run(dry_run: bool = False, today: date | None = None) -> list[Rating]:
    src = CsvRatingSource(config.ELO_CSV, today=today)
    ratings = src.get_ratings()
    validate_teams(ratings, today=today)
    asof = max(r.asof for r in ratings)
    print(f"Elo ingest: {len(ratings)} teams validated (as-of {asof}).")

    if dry_run:
        print("--dry-run: skipping Supabase upsert.")
        return ratings

    from etl import db  # lazy import so --dry-run needs no supabase creds/package wiring
    n = db.upsert_teams(ratings)
    print(f"Upserted {n} teams to Supabase.")
    return ratings


def main() -> None:
    ap = argparse.ArgumentParser(description="Elo ingest (CSV -> teams)")
    ap.add_argument("--dry-run", action="store_true", help="validate only, no DB write")
    args = ap.parse_args()
    run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
