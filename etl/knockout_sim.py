"""Full-tournament Monte Carlo job (P14): group → R32 (faithful Annex C) → champion.

Reads the same group matches + predictions + Elo as etl.simulate, runs
engine.group_sim.simulate_tournament, and upserts per-team round-reach + champion
probabilities (knockout_sim) and per-R32-slot occupancy (bracket_slot_sim). Idempotent.
Like simulate, run once per version per round (dc-v1.1 and dc-v1.2) — both share the
settled group locks, so version differences reflect Elo only.

    python -m etl.knockout_sim                          # simulate + write to Supabase
    python -m etl.knockout_sim --dry-run                # simulate + summarize, no DB
    python -m etl.knockout_sim --n 20000 --seed 42      # override count / deterministic
    python -m etl.knockout_sim --model-version dc-v1.1  # re-sim a specific version
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone

from engine.dixon_coles import MODEL_VERSION
from engine.group_sim import GroupMatch, SimConfig, simulate_tournament
from etl import db


def run(
    dry_run: bool = False,
    n: int = 10_000,
    seed: int | None = None,
    model_version: str | None = None,
) -> tuple[list[dict], list[dict]]:
    mv = model_version or MODEL_VERSION
    # Same inputs as etl.simulate: group matches + lambdas + settled scores.
    raw_matches = db.fetch_group_matches_with_predictions(model_version=mv)
    groups: dict[str, set[str]] = {}
    for m in raw_matches:
        groups.setdefault(m["group_label"], set()).update({m["home_team"], m["away_team"]})
    if len(groups) != 12:
        raise ValueError(f"Expected 12 groups, got {len(groups)} (fail-loud)")
    for gl, teams in sorted(groups.items()):
        if len(teams) != 4:
            raise ValueError(f"Group {gl} has {len(teams)} teams, expected 4 (fail-loud)")

    matches = [
        GroupMatch(
            match_id=m["match_id"], group_label=m["group_label"],
            home_team=m["home_team"], away_team=m["away_team"],
            lambda_home=m["lambda_home"], lambda_away=m["lambda_away"],
            is_settled=m["is_settled"], home_goals=m["home_goals"], away_goals=m["away_goals"],
        )
        for m in raw_matches
    ]
    team_elos = db.fetch_team_elos()

    teams, slots = simulate_tournament(matches, team_elos, SimConfig(n=n, seed=seed))
    assert len(teams) == 48, f"Expected 48 team results, got {len(teams)}"

    print(f"Tournament sim: N={n}, seed={seed}, model={mv}")
    print(f"  Settled group matches: {sum(1 for m in matches if m.is_settled)}/72 (locked)")
    print("  Top 10 by P(champion):")
    for r in sorted(teams, key=lambda x: -x.p_champion)[:10]:
        print(
            f"    {r.team_id} (G{r.group_label}): champ={r.p_champion:.1%}  "
            f"final={r.p_make_final:.1%} sf={r.p_make_sf:.1%} "
            f"qf={r.p_make_qf:.1%} r16={r.p_make_r16:.1%}"
        )

    now = datetime.now(timezone.utc).isoformat()
    team_rows = [
        {
            "team_id": r.team_id, "group_label": r.group_label,
            "p_make_r16": float(r.p_make_r16), "p_make_qf": float(r.p_make_qf),
            "p_make_sf": float(r.p_make_sf), "p_make_final": float(r.p_make_final),
            "p_champion": float(r.p_champion), "sim_n": r.sim_n,
            "model_version": mv, "computed_at": now,
        }
        for r in teams
    ]
    slot_rows = [
        {
            "match_no": s.match_no, "side": s.side, "team_id": s.team_id,
            "prob": float(s.prob), "sim_n": n, "model_version": mv, "computed_at": now,
        }
        for s in slots
    ]

    if dry_run:
        print(f"--dry-run: skipping writes ({len(team_rows)} knockout_sim, {len(slot_rows)} bracket_slot_sim).")
    else:
        db.upsert_knockout_sim(team_rows)
        db.replace_bracket_slot_sim(mv, slot_rows)
        print(f"Wrote {len(team_rows)} knockout_sim + {len(slot_rows)} bracket_slot_sim rows.")
    return team_rows, slot_rows


def main() -> None:
    ap = argparse.ArgumentParser(description="Full-tournament Monte Carlo → knockout_sim (P14)")
    ap.add_argument("--dry-run", action="store_true", help="compute + summarize, no DB write")
    ap.add_argument("--n", type=int, default=10_000, help="number of simulations (default: 10000)")
    ap.add_argument("--seed", type=int, default=None, help="RNG seed for reproducibility")
    ap.add_argument("--model-version", type=str, default=None,
                    help="model version whose predictions to simulate (default: engine MODEL_VERSION)")
    args = ap.parse_args()
    run(dry_run=args.dry_run, n=args.n, seed=args.seed, model_version=args.model_version)


if __name__ == "__main__":
    main()
