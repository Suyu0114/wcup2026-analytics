"""model_total_lines recompute (P3 spec §4.4; grid + push per P6 spec §3.4 / TB11).

After odds ingest, for every match with a prediction, precompute the model's
P(over) / P(under) / P(push) from the stored lambdas — NOT the fixed p_over_2_5 —
on the TOTALS_GRID (1.5–4.5, 0.25 step) plus the current Pinnacle main line if it
falls outside the grid. Reuses engine.dixon_coles. Idempotent upsert.
"""
from __future__ import annotations

from engine.dixon_coles import MAXG, MODEL_VERSION, score_matrix
from etl import db

# P6 §3.4: 13 lines, 0.25 step. Model mode can price any of these (TB11).
TOTALS_GRID = [1.5 + 0.25 * k for k in range(13)]          # 1.50 .. 4.50


def totals_distribution(lh: float, la: float, maxg: int = MAXG) -> list[float]:
    """P(total goals == s) for s in 0..2*maxg, from the τ-corrected matrix."""
    P = score_matrix(lh, la)
    t = [0.0] * (2 * maxg + 1)
    for i in range(maxg + 1):
        for j in range(maxg + 1):
            t[i + j] += P[i][j]
    return t


def line_probs(t: list[float], line: float) -> tuple[float, float, float]:
    """(p_over, p_under, p_push) at one line. p_push > 0 only on integer lines."""
    over = sum(p for s, p in enumerate(t) if s > line)
    under = sum(p for s, p in enumerate(t) if s < line)
    push = sum(p for s, p in enumerate(t) if s == line)
    return float(over), float(under), float(push)


def recompute(main_lines: dict[str, float], dry_run: bool = False) -> list[dict]:
    """main_lines: {match_id: pinnacle_main_point} (extra line beyond the grid)."""
    lambdas = db.fetch_match_lambdas(MODEL_VERSION)
    rows: list[dict] = []
    for match_id, (lh, la) in lambdas.items():
        lines = set(TOTALS_GRID)
        if match_id in main_lines:
            lines.add(float(main_lines[match_id]))
        t = totals_distribution(lh, la)                    # one matrix per match
        for line in sorted(lines):
            over, under, push = line_probs(t, line)
            rows.append({
                "match_id": match_id, "point": line, "model_version": MODEL_VERSION,
                "model_p_over": over, "model_p_under": under, "model_p_push": push,
            })
    print(f"model_total_lines: {len(rows)} (match, line) rows computed "
          f"({len(lambdas)} matches × grid{'+main' if main_lines else ''}).")
    if dry_run:
        return rows
    n = db.upsert_model_total_lines(rows)
    print(f"Upserted {n} model_total_lines.")
    return rows
