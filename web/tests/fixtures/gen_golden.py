"""Generate golden vectors for the value.ts ⇄ value.py parity test (TU5 / Issue 10).

Run from the repo root so `engine.value` is importable:
    python web/tests/fixtures/gen_golden.py

Writes golden_vectors.json next to this file. value.ts must reproduce these outputs exactly.
"""
import json
import os

from engine.value import (
    to_decimal,
    ev,
    kelly_fraction,
    is_quarter_line,
    is_half_line,
    ev_with_push,
    kelly_with_push,
    evaluate,
    evaluate_model_totals,
    evaluate_model_totals_quarter,
)

to_decimal_cases = []
for value, fmt in [
    (2.5, "decimal"),
    (1.5, "hongkong"),
    (0.5, "hongkong"),
    (150, "american"),
    (-200, "american"),
    (1.5, "indonesian"),
    (-2.0, "indonesian"),
    (0.5, "malaysian"),
    (-0.667, "malaysian"),
]:
    to_decimal_cases.append({"value": value, "fmt": fmt, "expected": to_decimal(value, fmt)})

ev_cases = []
for p, d in [(0.55, 2.0), (0.5, 2.1), (0.33, 3.0), (0.6, 1.5)]:
    ev_cases.append({"p": p, "d": d, "expected": ev(p, d)})

kelly_cases = []
for p, d, f in [(0.55, 2.0, 0.25), (0.5, 2.1, 0.25), (0.4, 2.0, 0.25), (0.6, 1.5, 0.5)]:
    kelly_cases.append({"p": p, "d": d, "fraction": f, "expected": kelly_fraction(p, d, f)})

quarter_cases = []
for pt in [2.0, 2.25, 2.5, 2.75, 3.0, 1.75]:
    quarter_cases.append({"point": pt, "expected": is_quarter_line(pt)})

evaluate_cases = []


def make(p, uv, fmt, *, point=None, pinnacle_main_point=None):
    res = evaluate(p, uv, fmt, point=point, pinnacle_main_point=pinnacle_main_point)
    # JS-friendly opts (camelCase) so the test can pass them straight to evaluate()
    opts = {}
    if point is not None:
        opts["point"] = point
    if pinnacle_main_point is not None:
        opts["pinnacleMainPoint"] = pinnacle_main_point
    evaluate_cases.append(
        {"p": p, "userValue": uv, "userFormat": fmt, "opts": opts, "expected": res}
    )


make(0.55, 2.0, "decimal")  # h2h value
make(0.55, 1.7, "decimal")  # h2h no value
make(0.5, 1.8, "hongkong")  # non-decimal format path
make(0.49, 2.0, "decimal", point=2.5, pinnacle_main_point=2.5)  # half line: exact (no flag)
make(0.49, 2.0, "decimal", point=2.25, pinnacle_main_point=2.25)  # quarter -> approximate
make(0.49, 2.0, "decimal", point=3.0, pinnacle_main_point=3.0)  # integer -> approximate (P6 TB7)
make(0.49, 2.0, "decimal", point=2.5, pinnacle_main_point=2.25)  # line mismatch

# --- P6 §3.4 push-aware model-mode arithmetic (TB6) ---
half_line_cases = [{"point": pt, "expected": is_half_line(pt)} for pt in [2.0, 2.25, 2.5, 2.75, 3.0, 3.5]]

ev_push_cases = []
for pw, pp, d in [(0.45, 0.10, 2.0), (0.55, 0.0, 1.9), (0.40, 0.15, 2.4), (0.61, 0.07, 1.8)]:
    ev_push_cases.append({"pWin": pw, "pPush": pp, "d": d, "expected": ev_with_push(pw, pp, d)})

kelly_push_cases = []
for pw, pp, d, f in [(0.45, 0.10, 2.0, 0.25), (0.55, 0.0, 1.9, 0.25), (0.61, 0.07, 2.4, 0.25)]:
    kelly_push_cases.append(
        {"pWin": pw, "pPush": pp, "d": d, "fraction": f, "expected": kelly_with_push(pw, pp, d, f)}
    )

model_totals_cases = []
for pw, pp, uv, fmt in [(0.45, 0.10, 2.0, "decimal"), (0.52, 0.0, 1.95, "decimal"), (0.61, 0.07, 1.0, "hongkong")]:
    model_totals_cases.append({
        "pWin": pw, "pPush": pp, "userValue": uv, "userFormat": fmt,
        "expected": evaluate_model_totals(pw, pp, uv, fmt),
    })

model_quarter_cases = []
for lo, hi, uv in [((0.55, 0.12), (0.43, 0.0), 2.05), ((0.40, 0.15), (0.30, 0.0), 2.6)]:
    model_quarter_cases.append({
        "lo": list(lo), "hi": list(hi), "userValue": uv, "userFormat": "decimal",
        "expected": evaluate_model_totals_quarter(lo, hi, uv, "decimal"),
    })

out = {
    "to_decimal": to_decimal_cases,
    "ev": ev_cases,
    "kelly": kelly_cases,
    "is_quarter_line": quarter_cases,
    "is_half_line": half_line_cases,
    "ev_with_push": ev_push_cases,
    "kelly_with_push": kelly_push_cases,
    "evaluate_model_totals": model_totals_cases,
    "evaluate_model_totals_quarter": model_quarter_cases,
    "evaluate": evaluate_cases,
}

path = os.path.join(os.path.dirname(__file__), "golden_vectors.json")
with open(path, "w", encoding="utf-8") as fh:
    json.dump(out, fh, indent=2)
print(f"wrote {path}")
