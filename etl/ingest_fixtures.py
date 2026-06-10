"""Fixtures ingest (P0, spec §4.2): football-data /WC/matches -> matches.

Resolves home/away via the alias map (fail-loud on a present-but-unknown team).
Knockout matches whose teams aren't drawn yet (home/away = None) are skipped;
re-running after the draw fills them in (idempotent upsert).

    python -m etl.ingest_fixtures             # load resolvable matches to Supabase
    python -m etl.ingest_fixtures --dry-run   # fetch + resolve + validate, no DB
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date, datetime

from etl import config, venues
from etl.identity import build_alias_map, resolve
from sources.fixture_source import Fixture, FootballDataFixtureSource
from sources.rating_source import CsvRatingSource

EXPECTED_TOTAL = 104           # all matches from source (TF1 upstream sanity)
EXPECTED_GROUP = 72            # 12 groups x 6 (resolvable pre-tournament)
EXPECTED_TEAMS = 48
# P6 A1 (TA1): group-stage host venue flags are a fixed invariant — hosts are at
# home in their own country 9 times; football-data lists them home 6x, away 3x.
EXPECTED_HOST_HOME = 6
EXPECTED_HOST_AWAY = 3
GROUP_LETTERS = set("ABCDEFGHIJKL")
KICKOFF_WINDOW = (date(2026, 6, 11), date(2026, 7, 19))


def _kickoff_date(iso: str) -> date:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).date()


def _has_teams(f: Fixture) -> bool:
    return bool(f.home_name or f.home_tla) and bool(f.away_name or f.away_tla)


def _match_row(f: Fixture, home_id: str, away_id: str) -> dict:
    # P6 A1: host venue lookup (raises for a host match with no curated venue).
    is_host_home, is_host_away = venues.host_flags(f.match_id, home_id, away_id, f.venue)
    return {
        "match_id": f.match_id,
        "stage": f.stage,
        "group_label": f.group_label,
        "home_team": home_id,
        "away_team": away_id,
        "kickoff_utc": f.kickoff_utc,
        "is_host_home": is_host_home,
        "is_host_away": is_host_away,
        "status": f.status,
    }


def validate(fixtures: list[Fixture], rows: list[dict]) -> None:
    """TF1–TF4 / T6 acceptance gate (spec §6), adapted for pre-draw knockout."""
    if len(fixtures) != EXPECTED_TOTAL:
        raise ValueError(f"TF1: source returned {len(fixtures)} matches, expected {EXPECTED_TOTAL}")

    group_rows = [r for r in rows if r["stage"] == "group"]
    if len(group_rows) != EXPECTED_GROUP:
        raise ValueError(f"TF1/TF2: {len(group_rows)} group matches, expected {EXPECTED_GROUP}")

    # TF2: 12 groups, 6 matches and 4 distinct teams each.
    by_group: dict[str, list[dict]] = defaultdict(list)
    for r in group_rows:
        by_group[r["group_label"]].append(r)
    if set(by_group) != GROUP_LETTERS:
        raise ValueError(f"TF2: group labels {sorted(by_group)} != A..L")
    for g, rs in by_group.items():
        if len(rs) != 6:
            raise ValueError(f"TF2: group {g} has {len(rs)} matches, expected 6")
        teams = {r["home_team"] for r in rs} | {r["away_team"] for r in rs}
        if len(teams) != 4:
            raise ValueError(f"TF2: group {g} has {len(teams)} teams, expected 4")

    # TF3/T6: every one of the 48 teams appears; unmapped already raised in resolve().
    refs = {r["home_team"] for r in group_rows} | {r["away_team"] for r in group_rows}
    if len(refs) != EXPECTED_TEAMS:
        raise ValueError(f"TF3/T6: {len(refs)} distinct teams referenced, expected {EXPECTED_TEAMS}")

    # TF4: group kickoffs within window, and group stage before any knockout date.
    for r in group_rows:
        d = _kickoff_date(r["kickoff_utc"])
        if not (KICKOFF_WINDOW[0] <= d <= KICKOFF_WINDOW[1]):
            raise ValueError(f"TF4: group kickoff {r['kickoff_utc']} outside {KICKOFF_WINDOW}")
    ko_dates = [_kickoff_date(f.kickoff_utc) for f in fixtures if f.stage != "group" and f.kickoff_utc]
    if ko_dates:
        latest_group = max(_kickoff_date(r["kickoff_utc"]) for r in group_rows)
        if latest_group > min(ko_dates):
            raise ValueError(f"TF4: group stage not before knockout ({latest_group} > {min(ko_dates)})")

    # TA1 (P6 A1): host venue flags — fixed group-stage invariant (6 home + 3 away).
    hh = sum(1 for r in group_rows if r["is_host_home"])
    ha = sum(1 for r in group_rows if r["is_host_away"])
    if (hh, ha) != (EXPECTED_HOST_HOME, EXPECTED_HOST_AWAY):
        raise ValueError(
            f"TA1: host flags (home={hh}, away={ha}) != expected "
            f"({EXPECTED_HOST_HOME}, {EXPECTED_HOST_AWAY}) — check etl/venues.py"
        )


def run(dry_run: bool = False, today: date | None = None) -> list[dict]:
    src = FootballDataFixtureSource()
    fixtures = src.get_fixtures()
    ratings = CsvRatingSource(config.ELO_CSV, today=today).get_ratings()
    alias_map = build_alias_map(src.get_teams(), ratings)

    rows: list[dict] = []
    skipped = 0
    for f in fixtures:
        if not _has_teams(f):
            skipped += 1            # knockout not drawn yet — fill in on a later run
            continue
        home_id = resolve(alias_map, f.home_tla, f.home_name)   # raises if unknown
        away_id = resolve(alias_map, f.away_tla, f.away_name)
        rows.append(_match_row(f, home_id, away_id))

    validate(fixtures, rows)
    n_host = sum(1 for r in rows if r["is_host_home"] or r["is_host_away"])
    no_venue = sum(1 for r, f in zip(rows, [f for f in fixtures if _has_teams(f)])
                   if not f.venue and not (r["is_host_home"] or r["is_host_away"]))
    print(
        f"Fixtures ingest: {len(rows)} matches resolved "
        f"({skipped} skipped — knockout teams not yet drawn); "
        f"{n_host} host-venue matches flagged; "
        f"{no_venue} non-host matches without venue (neutral assumed — warn, P6 TA1)."
    )

    if dry_run:
        print("--dry-run: skipping matches upsert.")
        return rows

    from etl import db
    n = db.upsert_matches(rows)
    print(f"Upserted {n} matches to Supabase.")
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description="Fixtures ingest (fd matches -> matches)")
    ap.add_argument("--dry-run", action="store_true", help="fetch + validate, no DB write")
    args = ap.parse_args()
    run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
