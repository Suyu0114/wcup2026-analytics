"""model_total_lines recompute (P3, spec §4.4 / §5.4).

After odds ingest, for each match's current Pinnacle totals line L, recompute the
model's P(over L) / P(under L) from the stored lambdas — NOT the fixed p_over_2_5.
Reuses engine.dixon_coles. A moved line produces a new (match, point) row.
"""
from __future__ import annotations

from engine.dixon_coles import MAXG, MODEL_VERSION, score_matrix
from etl import db


def model_over_under(lh: float, la: float, line: float, maxg: int = MAXG) -> tuple[float, float]:
    """P(total > line), P(total < line). Equal-to-line mass (whole-line push) is in neither."""
    P = score_matrix(lh, la)
    over = sum(P[i][j] for i in range(maxg + 1) for j in range(maxg + 1) if i + j > line)
    under = sum(P[i][j] for i in range(maxg + 1) for j in range(maxg + 1) if i + j < line)
    return float(over), float(under)


def recompute(main_lines: dict[str, float], dry_run: bool = False) -> list[dict]:
    """main_lines: {match_id: pinnacle_main_point}."""
    lambdas = db.fetch_match_lambdas(MODEL_VERSION)
    rows: list[dict] = []
    for match_id, line in main_lines.items():
        if match_id not in lambdas:
            continue                       # no prediction yet (e.g. knockout TBD)
        lh, la = lambdas[match_id]
        over, under = model_over_under(lh, la, line)
        rows.append({
            "match_id": match_id, "point": line, "model_version": MODEL_VERSION,
            "model_p_over": over, "model_p_under": under,
        })
    print(f"model_total_lines: {len(rows)} (match, line) rows computed.")
    if dry_run:
        return rows
    n = db.upsert_model_total_lines(rows)
    print(f"Upserted {n} model_total_lines.")
    return rows
