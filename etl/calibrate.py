"""Calibration learning line (P3, spec §6 / T10).

⚠️ NOT a gate (decision #7). 1X2 only (totals calibration not in v1). The model is
labeled EXPERIMENTAL regardless of result. Scores Brier + log-loss for both the
model and the Pinnacle closing de-vig on settled matches; n<30–40 => no conclusion.

    python -m etl.calibrate
"""
from __future__ import annotations

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


def run() -> dict:
    settled = [
        m for m in db.fetch_settled_matches()
        if m.get("home_goals") is not None and m.get("away_goals") is not None
    ]
    print("Calibration (T10 — NOT a gate; 1X2 only; model = EXPERIMENTAL):")
    if not settled:
        print("  0 settled matches — framework ready, nothing to score yet.")
        return {"n_settled": 0, "model": None, "market": None}

    model = db.fetch_match_predictions_1x2(MODEL_VERSION)
    market = {
        mid: novig(p)
        for mid, p in db.fetch_pinnacle_closing_h2h().items()
        if {"home", "draw", "away"} <= set(p)
    }
    m_scores, k_scores = [], []
    for m in settled:
        mid, res = m["match_id"], result_1x2(m["home_goals"], m["away_goals"])
        if mid in model:
            m_scores.append((brier(model[mid], res), log_loss(model[mid], res)))
        if mid in market:
            k_scores.append((brier(market[mid], res), log_loss(market[mid], res)))

    rep = {"n_settled": len(settled), "model": _agg(m_scores), "market": _agg(k_scores)}
    print(f"  settled: {len(settled)}")
    for src in ("model", "market"):
        a = rep[src]
        if a:
            print(f"  {src:6}: n={a['n']} Brier={a['brier']:.4f} log_loss={a['log_loss']:.4f}")
    if len(settled) < 30:
        print("  n<30–40 → 不下結論（spec §6）。")
    return rep


def main() -> None:
    run()


if __name__ == "__main__":
    main()
