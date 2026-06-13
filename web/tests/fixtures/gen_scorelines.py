"""Generate golden vectors for the scorelines.ts ⇄ engine score_matrix parity test.

Run from the repo root so `engine.dixon_coles` is importable:
    python web/tests/fixtures/gen_scorelines.py

Writes scoreline_vectors.json next to this file: for each (lambda_home, lambda_away)
pair, the top-5 scorelines of the normalized Dixon–Coles matrix (engine RHO/MAXG).
topScorelines() in web/lib/scorelines.ts must reproduce these probabilities.
"""
import json
import os

from engine.dixon_coles import MAXG, RHO, score_matrix

# Spread of realistic lambda pairs: balanced, favourite-skewed, low/high scoring.
LAMBDA_PAIRS = [
    (1.20, 1.20),
    (1.31, 1.10),   # ~ Canada v Bosnia territory
    (2.05, 0.70),   # strong favourite
    (0.85, 1.65),   # away favourite
    (1.45, 1.45),   # high-scoring balanced
    (0.60, 0.55),   # defensive grind
]

cases = []
for lh, la in LAMBDA_PAIRS:
    P = score_matrix(lh, la)
    cells = [
        {"home": i, "away": j, "p": P[i][j]}
        for i in range(MAXG + 1)
        for j in range(MAXG + 1)
    ]
    # same tie-break as scorelines.ts: p desc, then total goals asc, then home asc
    cells.sort(key=lambda c: (-c["p"], c["home"] + c["away"], c["home"]))
    cases.append({"lambda_home": lh, "lambda_away": la, "top": cells[:5]})

out = {"rho": RHO, "maxg": MAXG, "cases": cases}

path = os.path.join(os.path.dirname(__file__), "scoreline_vectors.json")
with open(path, "w", encoding="utf-8") as fh:
    json.dump(out, fh, indent=2)
print(f"wrote {path}")
