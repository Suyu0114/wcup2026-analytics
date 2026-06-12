"""Group-standings job (P8).

Reads group-stage matches + actual scores from Supabase, computes the FIFA-style
standings table (Played / W / D / L / GF / GA / GD / Pts) per group with the
display tiebreaker (Pts→GD→GF→H2H, then `tied`; see engine/standings.py), and
upserts to ``group_standings``. Idempotent.

Standings are a FACT derived from results — no model, no calibration, no
model_version. Group membership comes from the fixtures (not teams.group_label),
so every team shows even before kickoff. Only status='final' matches are counted.

    python -m etl.standings              # compute + write to Supabase
    python -m etl.standings --dry-run    # compute + print tables, no DB

Add as a step in the matchday recompute pipeline (after ingest_fixtures) so a
manually-entered score refreshes the table.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone

from engine.standings import compute_group_standings
from etl import db


def run(dry_run: bool = False) -> list[dict]:
    raw = db.fetch_group_matches_for_standings()

    # Derive group membership from fixtures (robust: every stored group match has both teams).
    group_teams: dict[str, set[str]] = {}
    for m in raw:
        gl = m["group_label"]
        group_teams.setdefault(gl, set())
        group_teams[gl].add(m["home_team"])
        group_teams[gl].add(m["away_team"])
    if len(group_teams) != 12:
        raise ValueError(f"Expected 12 groups, got {len(group_teams)} (fail-loud)")
    for gl, teams in sorted(group_teams.items()):
        if len(teams) != 4:
            raise ValueError(f"Group {gl} has {len(teams)} teams, expected 4 (fail-loud)")

    # Finished matches per group; verify-don't-assume: final must have goals.
    finished: dict[str, list[tuple[str, str, int, int]]] = {gl: [] for gl in group_teams}
    settled_count = 0
    for m in raw:
        if m["status"] != "final":
            continue
        if m["home_goals"] is None or m["away_goals"] is None:
            raise ValueError(
                f"Settled match {m['match_id']} (status='final') missing goals (verify-don't-assume)"
            )
        finished[m["group_label"]].append(
            (m["home_team"], m["away_team"], int(m["home_goals"]), int(m["away_goals"]))
        )
        settled_count += 1

    now = datetime.now(timezone.utc).isoformat()
    rows: list[dict] = []
    print(f"Standings: {settled_count}/72 group matches settled")
    for gl in sorted(group_teams):
        table = compute_group_standings(sorted(group_teams[gl]), finished[gl])
        print(f"  Group {gl}:")
        for r in table:
            mark = " (tied)" if r.tied else ""
            print(
                f"    {r.rank}. {r.team_id:<3} "
                f"P{r.played} W{r.wins} D{r.draws} L{r.losses} "
                f"GF{r.gf} GA{r.ga} GD{r.gd:+d} Pts{r.pts}{mark}"
            )
            rows.append({
                "team_id": r.team_id,
                "group_label": gl,
                "played": r.played,
                "wins": r.wins,
                "draws": r.draws,
                "losses": r.losses,
                "gf": r.gf,
                "ga": r.ga,
                "gd": r.gd,
                "pts": r.pts,
                "rank": r.rank,
                "tied": r.tied,
                "computed_at": now,
            })

    assert len(rows) == 48, f"Expected 48 standings rows, got {len(rows)}"

    if dry_run:
        print("--dry-run: skipping group_standings upsert.")
    else:
        written = db.upsert_group_standings(rows)
        print(f"Upserted {written} rows to group_standings.")

    return rows


def main() -> None:
    ap = argparse.ArgumentParser(
        description="FIFA-style group standings → group_standings (P8)"
    )
    ap.add_argument("--dry-run", action="store_true",
                    help="compute + print tables, no DB write")
    args = ap.parse_args()
    run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
