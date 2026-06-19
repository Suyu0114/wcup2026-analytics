"""Qualification scenario-analysis job (P11, spec §8.2).

Reads group-stage matches + actual scores from Supabase, computes the per-match
W/D/L qualification scenarios per group (engine, pure function), and replaces
``group_scenarios`` (full delete-all + insert). Idempotent.

Scenarios are a deterministic FACT derived from results — no model, no calibration,
no model_version (cf. etl/standings.py). Only pending (status!='final') matches get
scenarios; the table never holds a final match's rows. Group membership comes from
the fixtures (not teams.group_label).

    python -m etl.scenarios              # compute + write to Supabase
    python -m etl.scenarios --dry-run    # compute + print, no DB

Add as a step in the matchday recompute pipeline AFTER etl.standings, so a
manually-entered score refreshes the scenarios.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone

from engine.scenarios import OUTCOMES, ScenarioMatch, analyze_group
from etl import db


def run(dry_run: bool = False) -> list[dict]:
    raw = db.fetch_group_matches_for_standings()   # reuse P8 fetch (status + goals)

    # Derive group membership from fixtures (robust: every stored group match has both teams).
    by_group: dict[str, list[dict]] = {}
    for m in raw:
        by_group.setdefault(m["group_label"], []).append(m)
    if len(by_group) != 12:
        raise ValueError(f"Expected 12 groups, got {len(by_group)} (fail-loud)")

    now = datetime.now(timezone.utc).isoformat()
    rows: list[dict] = []
    pending_total = 0
    for gl in sorted(by_group):
        matches = [
            ScenarioMatch(
                match_id=m["match_id"],
                group_label=m["group_label"],
                home_team=m["home_team"],
                away_team=m["away_team"],
                status=m["status"],
                home_goals=None if m["home_goals"] is None else int(m["home_goals"]),
                away_goals=None if m["away_goals"] is None else int(m["away_goals"]),
            )
            for m in by_group[gl]
        ]
        scenarios = analyze_group(gl, matches)   # fail-loud: 4 teams, final has goals
        pending_total += len(scenarios)
        print(f"  Group {gl}: {len(scenarios)} pending match(es)")
        for s in scenarios:
            flags = []
            if s.convenience_draw:
                flags.append("convenience-draw")
            elif s.convenience_draw_kind:
                flags.append(s.convenience_draw_kind)
            if s.dead_rubber:
                flags.append("dead-rubber")
            mark = f"  [{', '.join(flags)}]" if flags else ""
            print(f"    {s.home_team} v {s.away_team}{mark}")
            for outcome in OUTCOMES:
                home_o, away_o = s.outcomes[outcome]
                for to in (home_o, away_o):
                    rows.append({
                        "match_id": s.match_id,
                        "group_label": s.group_label,
                        "outcome": outcome,
                        "team_id": to.team_id,
                        "status": to.status,
                        "can_win_group": to.can_win_group,
                        "secured_3rd_or_better": to.secured_3rd_or_better,
                        "needs_best_third": to.needs_best_third,
                        "seeding_live": to.seeding_live,
                        "basis_key": to.basis_key,
                        "convenience_draw": s.convenience_draw,
                        "convenience_draw_kind": s.convenience_draw_kind,
                        "dead_rubber": s.dead_rubber,
                        "computed_at": now,
                    })

    print(f"Scenarios: {pending_total} pending match(es) -> {len(rows)} rows")

    if dry_run:
        print("--dry-run: skipping group_scenarios replace.")
    else:
        written = db.replace_group_scenarios(rows)
        print(f"Replaced group_scenarios with {written} rows.")

    return rows


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Group-stage qualification scenarios → group_scenarios (P11)"
    )
    ap.add_argument("--dry-run", action="store_true",
                    help="compute + print, no DB write")
    args = ap.parse_args()
    run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
