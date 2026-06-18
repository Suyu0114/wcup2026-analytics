"""Prediction job (P1, spec §5.3): teams + matches -> match_predictions.

Reads team Elo + matches from Supabase, runs the Dixon–Coles engine, and upserts
one row per (match, model_version). Idempotent.

    python -m etl.predict                  # compute + write to Supabase
    python -m etl.predict --dry-run        # compute + summarize, no DB write
    python -m etl.predict --only-unsettled # P10: re-predict only unsettled matches
"""
from __future__ import annotations

import argparse

from engine.dixon_coles import MODEL_VERSION, predict_match
from etl import db


def build_prediction_row(match: dict, elo_home: float, elo_away: float) -> dict:
    """Pure: one matches row + both Elos -> one match_predictions row."""
    row = predict_match(
        elo_home,
        elo_away,
        bool(match.get("is_host_home")),
        bool(match.get("is_host_away")),
    )
    row["match_id"] = match["match_id"]
    return row


def run(dry_run: bool = False, only_unsettled: bool = False) -> list[dict]:
    elos = db.fetch_team_elos()
    matches = db.fetch_matches_to_predict(only_unsettled=only_unsettled)

    rows: list[dict] = []
    missing: list[str] = []
    for m in matches:
        eh, ea = elos.get(m["home_team"]), elos.get(m["away_team"])
        if eh is None or ea is None:
            missing.append(m["match_id"])          # FK should prevent this; fail loud if not
            continue
        rows.append(build_prediction_row(m, eh, ea))

    if missing:
        raise ValueError(
            f"predict: {len(missing)} matches reference teams with no Elo: {missing[:5]}"
        )

    scope = "unsettled only" if only_unsettled else "all matches"
    print(f"Predictions: {len(rows)} matches computed ({scope}, model {MODEL_VERSION}).")
    if dry_run:
        print("--dry-run: skipping match_predictions upsert.")
        return rows

    n = db.upsert_predictions(rows)
    print(f"Upserted {n} predictions to Supabase.")
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description="Prediction job (teams + matches -> match_predictions)")
    ap.add_argument("--dry-run", action="store_true", help="compute + summarize, no DB write")
    ap.add_argument(
        "--only-unsettled",
        action="store_true",
        help="predict only matches with status != 'final' (P10 dc-v1.2 re-predict)",
    )
    args = ap.parse_args()
    run(dry_run=args.dry_run, only_unsettled=args.only_unsettled)


if __name__ == "__main__":
    main()
