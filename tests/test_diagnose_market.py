"""Market-divergence diagnosis acceptance (P6 TA6) — pure parts, offline."""
from etl.diagnose_market import DISCLAIMER, diagnose_h2h, diagnose_totals, pinnacle_main_point, render


def _series(home, draw, away):
    return {("home", None): home, ("draw", None): draw, ("away", None): away}


def test_h2h_signed_bias_and_sorting():
    model = {
        "m1": {"home": 0.60, "draw": 0.25, "away": 0.15},
        "m2": {"home": 0.30, "draw": 0.30, "away": 0.40},
        "m3": {"home": 0.50, "draw": 0.30, "away": 0.20},   # no market -> excluded
    }
    market = {
        "m1": _series(2.0, 4.0, 6.0),     # novig: 0.545, 0.273, 0.182
        "m2": _series(3.0, 3.0, 3.0),     # novig: 1/3 each
    }
    rep = diagnose_h2h(model, market)
    assert rep["n"] == 2
    # m1 home diff = 0.60 - 0.5454.. = +0.0545..; m2 home diff = 0.30 - 0.3333 = -0.0333
    assert abs(rep["mean_signed"]["home"] - ((0.60 - 6 / 11) + (0.30 - 1 / 3)) / 2) < 1e-9
    # sorted by max abs diff descending
    assert rep["rows"][0]["max_abs"] >= rep["rows"][1]["max_abs"]
    # favorite bias: m1 favorite=home (+0.0545), m2 favorite tie -> max() picks 'home' (-0.0333)
    assert abs(rep["favorite_bias"] - ((0.60 - 6 / 11) + (0.30 - 1 / 3)) / 2) < 1e-9


def test_main_point_picks_closest_sides():
    series = {
        ("over", 2.5): 2.10, ("under", 2.5): 1.74,   # gap |0.476-0.575| = 0.098
        ("over", 2.75): 1.95, ("under", 2.75): 1.90, # gap |0.513-0.526| = 0.013 -> main
    }
    assert pinnacle_main_point(series) == 2.75


def test_totals_push_conditioning():
    # model row at an integer line excludes push mass; comparison must renormalize.
    model_lines = {("m1", 3.0): (0.45, 0.45)}        # push 0.10 -> conditioned over = 0.5
    market = {"m1": {("over", 3.0): 1.95, ("under", 3.0): 1.95}}
    rep = diagnose_totals(model_lines, market)
    assert rep["n"] == 1
    assert abs(rep["rows"][0]["model_p_over"] - 0.5) < 1e-9
    assert abs(rep["rows"][0]["diff"]) < 1e-9        # market novig = 0.5 too


def test_render_includes_disclaimer():
    md = render({"n": 0, "rows": []}, {"n": 0, "rows": []}, {}, "dc-v1.0")
    assert DISCLAIMER in md
