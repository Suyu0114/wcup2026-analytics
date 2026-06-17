"""Group-stage simulation job (P2, spec §5.1).

Reads group matches + predictions + Elo from Supabase, runs Monte Carlo
simulation (engine, pure function), and upserts per-team advancement
probabilities to ``group_sim``. Idempotent.

    python -m etl.simulate                          # simulate + write to Supabase
    python -m etl.simulate --dry-run                # simulate + summarize, no DB
    python -m etl.simulate --n 50000                # override simulation count
    python -m etl.simulate --seed 42                # deterministic (for tests/debugging)
    python -m etl.simulate --model-version dc-v1.1  # P10: re-sim a specific version
"""
from __future__ import annotations

import argparse
import string
from datetime import datetime, timezone

from engine.dixon_coles import MODEL_VERSION
from engine.group_sim import GroupMatch, SimConfig, simulate_groups
from etl import db


def run(
    dry_run: bool = False,
    n: int = 10_000,
    seed: int | None = None,
    model_version: str | None = None,
) -> list[dict]:
    mv = model_version or MODEL_VERSION
    # 1. Read group-stage matches + lambdas + actual scores (settled)
    raw_matches = db.fetch_group_matches_with_predictions(model_version=mv)
    # Validate: 12 groups × 4 teams
    groups: dict[str, set[str]] = {}
    for m in raw_matches:
        gl = m["group_label"]
        groups.setdefault(gl, set())
        groups[gl].add(m["home_team"])
        groups[gl].add(m["away_team"])
    if len(groups) != 12:
        raise ValueError(f"Expected 12 groups, got {len(groups)} (fail-loud)")
    for gl, teams in sorted(groups.items()):
        if len(teams) != 4:
            raise ValueError(f"Group {gl} has {len(teams)} teams, expected 4 (fail-loud)")

    # Convert to engine dataclasses
    matches = [
        GroupMatch(
            match_id=m["match_id"],
            group_label=m["group_label"],
            home_team=m["home_team"],
            away_team=m["away_team"],
            lambda_home=m["lambda_home"],
            lambda_away=m["lambda_away"],
            is_settled=m["is_settled"],
            home_goals=m["home_goals"],
            away_goals=m["away_goals"],
        )
        for m in raw_matches
    ]

    team_elos = db.fetch_team_elos()

    # 2. Run simulation (engine, pure function, no I/O)
    config = SimConfig(n=n, seed=seed)
    results = simulate_groups(matches, team_elos, config)
    assert len(results) == 48, f"Expected 48 team results, got {len(results)}"

    # 3. Print summary
    settled_count = sum(1 for m in matches if m.is_settled)
    print(f"Simulation: N={n}, seed={seed}, model={mv}")
    print(f"  Settled matches: {settled_count}/72 (locked)")
    print(f"  Top 10 by P(advance):")
    for r in sorted(results, key=lambda x: -x.p_advance)[:10]:
        print(
            f"    {r.team_id} (Group {r.group_label}): "
            f"advance={r.p_advance:.1%}  "
            f"(1st={r.p_first:.1%} 2nd={r.p_second:.1%} 3rd-q={r.p_third_qual:.1%})"
        )

    # 4. Write
    now = datetime.now(timezone.utc).isoformat()
    rows = [
        {
            "team_id": r.team_id,
            "group_label": r.group_label,
            "p_first": float(r.p_first),
            "p_second": float(r.p_second),
            "p_third_qual": float(r.p_third_qual),
            "p_advance": float(r.p_advance),
            "sim_n": r.sim_n,
            # stamp the simulated version (mv), not the engine constant — lets
            # `--model-version dc-v1.1` write v1.1 group_sim rows (P10 D-decision).
            "model_version": mv,
            "computed_at": now,
        }
        for r in results
    ]

    if dry_run:
        print("--dry-run: skipping group_sim upsert.")
    else:
        written = db.upsert_group_sim(rows)
        print(f"Upserted {written} rows to group_sim.")

    return rows


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Group-stage Monte Carlo simulation → group_sim (P2)"
    )
    ap.add_argument("--dry-run", action="store_true",
                     help="compute + summarize, no DB write")
    ap.add_argument("--n", type=int, default=10_000,
                     help="number of simulations (default: 10000)")
    ap.add_argument("--seed", type=int, default=None,
                     help="RNG seed for reproducibility")
    ap.add_argument("--model-version", type=str, default=None,
                     help="model version whose predictions to simulate "
                          "(default: engine MODEL_VERSION; P10: pass dc-v1.1 to re-sim baseline)")
    args = ap.parse_args()
    run(dry_run=args.dry_run, n=args.n, seed=args.seed, model_version=args.model_version)


if __name__ == "__main__":
    main()
