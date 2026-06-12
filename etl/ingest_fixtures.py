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

from etl import config, results, venues
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


def _resolve_score(
    f: Fixture, overrides: dict[str, tuple[int, int]]
) -> tuple[str, int | None, int | None]:
    """Effective (status, home_goals, away_goals), reconciling fd with curated results.

    fd's matchday data is unreliable on the free tier (verified 2026-06-11: 537327
    flapped FINISHED→TIMED, score null throughout). So a hand-verified curated result
    is authoritative: when present it settles the match regardless of fd's status, and a
    *conflicting* non-null fd score fails loud (verify-don't-assume). With no override, a
    fd FINISHED-without-score is left unsettled ('live') so the ingest isn't blocked and
    simulate falls back to pre-match probabilities.

    `overrides` is {match_id: (home_goals, away_goals)} merged from the DB
    (manual_results, admin-entered) over the code seed (etl/results.py); DB wins.
    """
    override = overrides.get(f.match_id)
    fd_has_score = f.home_goals is not None and f.away_goals is not None
    if override is not None:
        if fd_has_score and (f.home_goals, f.away_goals) != override:
            raise ValueError(
                f"curated result {override} for match {f.match_id} conflicts with "
                f"football-data ({f.home_goals},{f.away_goals}) — reconcile manual_results / etl/results.py"
            )
        return "final", override[0], override[1]
    if f.status == "final" and not fd_has_score:
        return "live", None, None
    return f.status, f.home_goals, f.away_goals


def _match_row(f: Fixture, home_id: str, away_id: str, overrides: dict[str, tuple[int, int]]) -> dict:
    # P6 A1: host venue lookup (raises for a host match with no curated venue).
    is_host_home, is_host_away = venues.host_flags(f.match_id, home_id, away_id, f.venue)
    status, home_goals, away_goals = _resolve_score(f, overrides)
    return {
        "match_id": f.match_id,
        "stage": f.stage,
        "group_label": f.group_label,
        "home_team": home_id,
        "away_team": away_id,
        "kickoff_utc": f.kickoff_utc,
        "is_host_home": is_host_home,
        "is_host_away": is_host_away,
        "status": status,
        "home_goals": home_goals,
        "away_goals": away_goals,
    }


def assert_settled_have_goals(rows: list[dict]) -> None:
    """A match marked final must carry a score, else simulate/calibrate fail-loud later."""
    for r in rows:
        if r["status"] == "final" and (r["home_goals"] is None or r["away_goals"] is None):
            raise ValueError(
                f"Settled match {r['match_id']} (status='final') missing goals "
                f"(home={r['home_goals']}, away={r['away_goals']}) — verify-don't-assume"
            )


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

    # Settled matches must carry a score (verify-don't-assume — mirrors the fail-loud
    # guard in db.fetch_group_matches_with_predictions, but caught here at ingest time).
    assert_settled_have_goals(rows)


def _load_overrides() -> dict[str, tuple[int, int]]:
    """Curated result overrides: DB (manual_results, admin-entered) over the code seed
    (etl/results.py). Graceful: if the DB/table is unavailable, use the code seed only."""
    overrides: dict[str, tuple[int, int]] = dict(results.RESULTS)
    try:
        from etl import db
        overrides.update(db.fetch_manual_results())
    except Exception as e:
        print(f"  (manual_results unavailable — using etl/results.py seed only: {e})")
    return overrides


def run(dry_run: bool = False, today: date | None = None) -> list[dict]:
    src = FootballDataFixtureSource()
    fixtures = src.get_fixtures()
    ratings = CsvRatingSource(config.ELO_CSV, today=today).get_ratings()
    alias_map = build_alias_map(src.get_teams(), ratings)
    overrides = _load_overrides()

    rows: list[dict] = []
    skipped = 0
    for f in fixtures:
        if not _has_teams(f):
            skipped += 1            # knockout not drawn yet — fill in on a later run
            continue
        home_id = resolve(alias_map, f.home_tla, f.home_name)   # raises if unknown
        away_id = resolve(alias_map, f.away_tla, f.away_name)
        rows.append(_match_row(f, home_id, away_id, overrides))

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

    # Matchday: surface curated overrides applied + fd FINISHED-without-score left unsettled.
    with_teams = [f for f in fixtures if _has_teams(f)]
    overridden = [f for f in with_teams if f.match_id in overrides]
    awaiting = [
        f for f in with_teams
        if f.match_id not in overrides
        and f.status == "final" and (f.home_goals is None or f.away_goals is None)
    ]
    if overridden:
        ids = ", ".join(f.match_id for f in overridden)
        print(f"  {len(overridden)} match(es) settled from curated override (manual_results/seed): {ids}")
    if awaiting:
        ids = ", ".join(f.match_id for f in awaiting)
        print(
            f"  WARNING: {len(awaiting)} match(es) FINISHED upstream but no score yet — left "
            f"UNSETTLED. Enter the verified score (admin page / manual_results) and re-run: {ids}"
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
