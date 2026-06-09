"""Odds-API alias seeding (P3, spec §4.0): odds team names -> team_aliases.

MUST run before odds ingest. Uses the free events endpoint (0 credits). Resolves
each odds name against Elo names + existing aliases (normalized), then
MANUAL_ALIASES_ODDS; unresolved -> raise (fail-loud).

    python -m etl.ingest_odds_aliases             # seed team_aliases (source='odds_api')
    python -m etl.ingest_odds_aliases --dry-run   # resolve + report, no DB write
"""
from __future__ import annotations

import argparse

from etl import db
from etl.identity import build_norm_index, resolve_odds_names
from sources.odds_source import TheOddsApiSource

EXPECTED_TEAMS = 48


def run(dry_run: bool = False) -> dict[str, str]:
    src = TheOddsApiSource()
    events = src.get_events()
    names = sorted({e.home_team for e in events} | {e.away_team for e in events})

    norm_index = build_norm_index(db.fetch_teams(), db.fetch_aliases())
    amap, unresolved = resolve_odds_names(names, norm_index)

    print(f"Odds alias seeding: {len(names)} odds names -> resolved {len(amap)}, unresolved {len(unresolved)}.")
    if unresolved:
        print("  UNRESOLVED (add to identity.MANUAL_ALIASES_ODDS):")
        for n in unresolved:
            print(f"    {n!r}")
        raise ValueError(f"{len(unresolved)} odds team name(s) unresolved")

    covered = set(amap.values())
    if len(covered) != EXPECTED_TEAMS:
        raise ValueError(f"odds alias seeding: covered {len(covered)} team_ids, expected {EXPECTED_TEAMS}")

    if dry_run:
        print("--dry-run: skipping team_aliases upsert.")
        return amap

    n = db.upsert_aliases(amap, source="odds_api")
    print(f"Upserted {n} odds aliases to Supabase.")
    return amap


def main() -> None:
    ap = argparse.ArgumentParser(description="Odds-API alias seeding (odds names -> team_aliases)")
    ap.add_argument("--dry-run", action="store_true", help="resolve + report, no DB write")
    args = ap.parse_args()
    run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
