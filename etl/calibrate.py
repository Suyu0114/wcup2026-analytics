"""Calibration learning line (P3 spec §6 / T10; P6 §3.5 / TA5 / TB12).

⚠️ NOT a model gate (P3 decision #7) — but per P6 the SAME numbers now drive one
switch: the model-mode Kelly unlock (n≥30 and model Brier ≤ market×1.1), judged
server-side in the web app from `calibration_runs`. 1X2 only. The model is
labeled EXPERIMENTAL regardless of result.

Per P6 TA5 every model_version present in match_predictions is scored on the
same settled batch, and every run appends one calibration_runs row per version
(including n=0, so the frontend can show "progress 0/30").

    python -m etl.calibrate [--dry-run]
"""
from __future__ import annotations

import argparse
import math

from engine.dixon_coles import MODEL_VERSION
from engine.value import novig
from etl import db

OUTCOMES = ("home", "draw", "away")


def result_1x2(home_goals: int, away_goals: int) -> str:
    if home_goals > away_goals:
        return "home"
    if home_goals < away_goals:
        return "away"
    return "draw"


def brier(probs: dict[str, float], outcome: str) -> float:
    return sum((probs[o] - (1.0 if o == outcome else 0.0)) ** 2 for o in OUTCOMES)


def log_loss(probs: dict[str, float], outcome: str, eps: float = 1e-15) -> float:
    return -math.log(min(max(probs[outcome], eps), 1.0 - eps))


def _agg(scores: list[tuple[float, float]]) -> dict | None:
    if not scores:
        return None
    n = len(scores)
    return {"n": n, "brier": sum(b for b, _ in scores) / n, "log_loss": sum(l for _, l in scores) / n}


def _score(prob_map: dict, settled: list[dict]) -> dict | None:
    scores = []
    for m in settled:
        mid, res = m["match_id"], result_1x2(m["home_goals"], m["away_goals"])
        if mid in prob_map:
            scores.append((brier(prob_map[mid], res), log_loss(prob_map[mid], res)))
    return _agg(scores)


def run(dry_run: bool = False) -> dict:
    settled = [
        m for m in db.fetch_settled_matches()
        if m.get("home_goals") is not None and m.get("away_goals") is not None
    ]
    print("Calibration (T10 — NOT a model gate; 1X2 only; model = EXPERIMENTAL):")
    print(f"  settled: {len(settled)}")

    market = {
        mid: novig(p)
        for mid, p in (db.fetch_pinnacle_closing_h2h().items() if settled else [])
        if {"home", "draw", "away"} <= set(p)
    }
    k_agg = _score(market, settled) if settled else None

    versions = db.fetch_prediction_versions() or [MODEL_VERSION]
    report: dict = {"n_settled": len(settled), "market": k_agg, "models": {}}
    for v in versions:
        m_agg = _score(db.fetch_match_predictions_1x2(v), settled) if settled else None
        report["models"][v] = m_agg
        row = {
            "model_version": v,
            "n_settled": len(settled),
            "model_brier": m_agg["brier"] if m_agg else None,
            "model_logloss": m_agg["log_loss"] if m_agg else None,
            "market_brier": k_agg["brier"] if k_agg else None,
            "market_logloss": k_agg["log_loss"] if k_agg else None,
        }
        if dry_run:
            print(f"  --dry-run: skipping calibration_runs insert for {v}")
        else:
            db.insert_calibration_run(row)   # also when n=0 -> frontend progress 0/30
        if m_agg:
            print(f"  {v}: n={m_agg['n']} Brier={m_agg['brier']:.4f} log_loss={m_agg['log_loss']:.4f}")
        else:
            print(f"  {v}: nothing to score yet (calibration_runs row written, n=0)")
    if k_agg:
        print(f"  market: n={k_agg['n']} Brier={k_agg['brier']:.4f} log_loss={k_agg['log_loss']:.4f}")
    if len(settled) < 30:
        print("  n<30–40 → 不下結論（P3 §6）；模型模式 Kelly 維持鎖定（P6 §3.5）。")
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description="Calibration learning line -> calibration_runs")
    ap.add_argument("--dry-run", action="store_true", help="score only, no calibration_runs insert")
    args = ap.parse_args()
    run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
