"""Alias seeding (P0, spec §4.1b): football-data /WC/teams -> team_aliases.

MUST run before fixtures ingest. Seeds both name and tla -> team_id for all 48
teams; fails loud if any team can't be resolved.

    python -m etl.ingest_aliases             # seed Supabase team_aliases
    python -m etl.ingest_aliases --dry-run   # build + validate map, no DB
"""
from __future__ import annotations

import argparse
from datetime import date

from etl import config
from etl.identity import build_alias_map
from sources.fixture_source import FootballDataFixtureSource
from sources.rating_source import CsvRatingSource

EXPECTED_TEAMS = 48


def run(dry_run: bool = False, today: date | None = None) -> dict[str, str]:
    src = FootballDataFixtureSource()
    fd_teams = src.get_teams()
    ratings = CsvRatingSource(config.ELO_CSV, today=today).get_ratings()

    alias_map = build_alias_map(fd_teams, ratings)  # raises on any unresolved team
    covered = set(alias_map.values())
    if len(covered) != EXPECTED_TEAMS:
        raise ValueError(
            f"alias seeding: covered {len(covered)} team_ids, expected {EXPECTED_TEAMS}"
        )
    print(
        f"Alias seeding: {len(fd_teams)} fd teams -> {len(alias_map)} alias rows "
        f"over {len(covered)} team_ids."
    )

    if dry_run:
        print("--dry-run: skipping team_aliases upsert.")
        return alias_map

    from etl import db
    n = db.upsert_aliases(alias_map, source="fixtures")
    print(f"Upserted {n} aliases to Supabase.")
    return alias_map


def main() -> None:
    ap = argparse.ArgumentParser(description="Alias seeding (fd teams -> team_aliases)")
    ap.add_argument("--dry-run", action="store_true", help="build + validate, no DB write")
    args = ap.parse_args()
    run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
