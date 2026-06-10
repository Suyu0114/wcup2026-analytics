"""Market-divergence diagnosis (P6 spec §2.3, A3). READ-ONLY — writes no DB rows.

Compares the active model's probabilities against Pinnacle de-vig across all
matches that have both, pre-tournament. Purpose: diagnose the MODEL (systematic
bias: favorites too strong? draws too low?), NOT to find value. Output goes to
stdout + fit/DIAGNOSIS.md.

    python -m etl.diagnose_market
"""
from __future__ import annotations

from pathlib import Path

from engine.dixon_coles import MODEL_VERSION
from engine.value import novig
from etl import db

DISCLAIMER = (
    "Diagnosis of the MODEL, not a value list: a large divergence usually means "
    "the model is wrong, not the market."
)
OUTCOMES = ("home", "draw", "away")
DIAGNOSIS_PATH = Path(__file__).resolve().parent.parent / "fit" / "DIAGNOSIS.md"


def pinnacle_main_point(series: dict) -> float | None:
    """Main totals line = the point whose two sides are closest in implied prob
    (P3 spec §2). series: {(outcome, point): decimal_odds}."""
    best, best_gap = None, float("inf")
    for pt in sorted({pt for (_, pt) in series if pt is not None}):
        over, under = series.get(("over", pt)), series.get(("under", pt))
        if over and under:
            gap = abs(1.0 / over - 1.0 / under)
            if gap < best_gap:
                best, best_gap = pt, gap
    return best


def diagnose_h2h(model: dict, market_prices: dict) -> dict:
    """Pure. model: {mid: {outcome: p}}; market_prices: {mid: {(outcome, None): price}}.
    Returns per-outcome signed/abs bias, favorite bias, and per-match divergences."""
    rows = []
    for mid, probs in model.items():
        series = market_prices.get(mid)
        if not series:
            continue
        prices = {o: series.get((o, None)) for o in OUTCOMES}
        if any(p is None for p in prices.values()):
            continue
        mkt = novig(prices)
        diffs = {o: probs[o] - mkt[o] for o in OUTCOMES}
        fav = max(OUTCOMES, key=lambda o: mkt[o])
        rows.append({
            "match_id": mid, "model": probs, "market": mkt, "diffs": diffs,
            "max_abs": max(abs(d) for d in diffs.values()),
            "fav_diff": diffs[fav],
        })
    n = len(rows)
    if n == 0:
        return {"n": 0, "rows": []}
    return {
        "n": n,
        "mean_signed": {o: sum(r["diffs"][o] for r in rows) / n for o in OUTCOMES},
        "mean_abs": {o: sum(abs(r["diffs"][o]) for r in rows) / n for o in OUTCOMES},
        "favorite_bias": sum(r["fav_diff"] for r in rows) / n,
        "rows": sorted(rows, key=lambda r: -r["max_abs"]),
    }


def diagnose_totals(model_lines: dict, market_totals: dict) -> dict:
    """Pure. model_lines: {(mid, point): (p_over, p_under)};
    market_totals: {mid: {(outcome, point): price}}. Compares at the main line."""
    rows = []
    for mid, series in market_totals.items():
        pt = pinnacle_main_point(series)
        if pt is None or (mid, pt) not in model_lines:
            continue
        over, under = series[("over", pt)], series[("under", pt)]
        mkt = novig({"over": over, "under": under})
        m_over, m_under = model_lines[(mid, pt)]
        # model rows exclude the push mass; condition on non-push for comparability
        m_over_c = m_over / (m_over + m_under) if (m_over + m_under) > 0 else 0.0
        rows.append({
            "match_id": mid, "point": pt,
            "model_p_over": m_over_c, "market_p_over": mkt["over"],
            "diff": m_over_c - mkt["over"],
        })
    n = len(rows)
    if n == 0:
        return {"n": 0, "rows": []}
    return {
        "n": n,
        "mean_signed": sum(r["diff"] for r in rows) / n,
        "mean_abs": sum(abs(r["diff"]) for r in rows) / n,
        "rows": sorted(rows, key=lambda r: -abs(r["diff"])),
    }


def render(h2h: dict, totals: dict, names: dict, model_version: str, top: int = 10) -> str:
    L = [f"# Market divergence diagnosis — {model_version}", "", f"> {DISCLAIMER}", ""]
    L.append(f"## 1X2 (n={h2h['n']} matches with Pinnacle h2h + prediction)")
    if h2h["n"]:
        L.append("")
        L.append("| outcome | mean signed (model − market) | mean abs |")
        L.append("|---|---|---|")
        for o in OUTCOMES:
            L.append(f"| {o} | {h2h['mean_signed'][o]:+.4f} | {h2h['mean_abs'][o]:.4f} |")
        L.append("")
        L.append(f"Favorite bias (model − market on the market favorite): "
                 f"**{h2h['favorite_bias']:+.4f}**")
        L.append("")
        L.append(f"### Top {top} divergent matches (by max abs outcome diff)")
        L.append("")
        L.append("| match | outcome diffs (model − market) | max |")
        L.append("|---|---|---|")
        for r in h2h["rows"][:top]:
            d = ", ".join(f"{o} {r['diffs'][o]:+.3f}" for o in OUTCOMES)
            L.append(f"| {names.get(r['match_id'], r['match_id'])} | {d} | {r['max_abs']:.3f} |")
    L.append("")
    L.append(f"## Totals at Pinnacle main line (n={totals['n']})")
    if totals["n"]:
        L.append("")
        L.append(f"Mean signed (model P(over) − market P(over), push-conditioned): "
                 f"**{totals['mean_signed']:+.4f}**; mean abs {totals['mean_abs']:.4f}")
        L.append("")
        L.append("| match | line | model over | market over | diff |")
        L.append("|---|---|---|---|---|")
        for r in totals["rows"][:top]:
            L.append(f"| {names.get(r['match_id'], r['match_id'])} | {r['point']} "
                     f"| {r['model_p_over']:.3f} | {r['market_p_over']:.3f} | {r['diff']:+.3f} |")
    L.append("")
    return "\n".join(L)


def run(model_version: str = MODEL_VERSION) -> dict:
    print(f"Market divergence diagnosis ({model_version}) — READ-ONLY.")
    print(f"  {DISCLAIMER}")
    h2h = diagnose_h2h(
        db.fetch_match_predictions_1x2(model_version),
        db.fetch_latest_pinnacle("h2h"),
    )
    totals = diagnose_totals(
        db.fetch_model_total_lines_map(model_version),
        db.fetch_latest_pinnacle("totals"),
    )
    names = db.fetch_matches_with_names()
    md = render(h2h, totals, names, model_version)
    DIAGNOSIS_PATH.parent.mkdir(parents=True, exist_ok=True)
    DIAGNOSIS_PATH.write_text(md, encoding="utf-8")
    print(f"  1X2: n={h2h['n']}", end="")
    if h2h["n"]:
        ms = h2h["mean_signed"]
        print(f"  signed home {ms['home']:+.4f} / draw {ms['draw']:+.4f} / away {ms['away']:+.4f}"
              f"  favorite_bias {h2h['favorite_bias']:+.4f}", end="")
    print()
    print(f"  totals: n={totals['n']}", end="")
    if totals["n"]:
        print(f"  signed over {totals['mean_signed']:+.4f}", end="")
    print()
    print(f"  report -> {DIAGNOSIS_PATH}")
    return {"h2h": h2h, "totals": totals}


def main() -> None:
    run()


if __name__ == "__main__":
    main()
