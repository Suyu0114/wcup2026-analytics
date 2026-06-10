"""Historical fit of the Dixon-Coles engine parameters (P6 spec §2.2, A2).

Offline script — reads the two raw CSVs, never touches Supabase.

    python -m fit.fit_dc            # fit + validate + write fit/REPORT.md

Method (spec §2.2.3, two-stage):
  Stage 1  Poisson GLM per team-row:
             log λ = α + β·Δelo/400 + η·home_sign + f·friendly
           home_sign ∈ {+1,−1,0} (signed — NOT a 0/1 flag; engine applies HFA
           symmetrically to the Elo difference d, review R2).
  Stage 2  RHO by profile likelihood on the τ-corrected low-score cells.

Hard rules (spec §2.2.2, TA3): ratings come from the LAST snapshot STRICTLY
BEFORE the match date — no forward interpolation (look-ahead leakage). The
interpolated variant runs as a *diagnostic only* (attenuation sensitivity).

Gate (spec §2.2.4, TA4): time split; candidate must beat the dc-v1.0 priors on
validation 1X2 log-loss, else NO bump. Deployed constants = full-window refit
with the selected half-life (gate decided on the train-fitted params; both
parameter sets are in the REPORT — impl note).
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import poisson

import engine.dixon_coles as dc_engine

ROOT = Path(__file__).resolve().parent.parent
RESULTS_CSV = ROOT / "etl" / "data" / "raw" / "intl_results" / "results.csv"
SHOOTOUTS_CSV = ROOT / "etl" / "data" / "raw" / "intl_results" / "shootouts.csv"
ELO_CSV = ROOT / "etl" / "data" / "raw" / "elo" / "elo_ratings_wc2026.csv"
REPORT_PATH = ROOT / "fit" / "REPORT.md"

# --- spec constants (§2.2.1 / §2.2.3 / §2.2.4) ---
ERA_START = "2010-01-01"
TRAIN_END = "2023-12-31"
VAL_END = "2026-06-08"
HALF_LIVES: list[float | None] = [None, 2.0, 4.0, 8.0]   # years; None = no decay
RHO_GRID = np.round(np.arange(-0.20, 0.0501, 0.01), 4)
MAXG = 10
MIN_MATCHES = 750            # TA3 n guard
MAX_DROP_RATE = 0.05         # TA3 snapshot-coverage guard
MIN_MATCHES_PER_TEAM = 20    # silent-mapping-miss guard (every WC team plays plenty)
EPS = 1e-15

# martj42 name -> Elo CSV `country` (only divergence found, verified 2026-06-10).
MANUAL_NAMES = {"Czech Republic": "Czechia"}

REQUIRED_COLS = {"date", "home_team", "away_team", "home_score", "away_score",
                 "tournament", "city", "country", "neutral"}


# ---------- data ----------

def load_elo_history() -> tuple[dict, set[str]]:
    """{country: (snapshot_dates asc, ratings)} for the 48 WC2026 teams."""
    df = pd.read_csv(ELO_CSV)
    df["snapshot_date"] = pd.to_datetime(df["snapshot_date"])
    hist = {}
    for c, g in df.groupby("country"):
        g = g.sort_values("snapshot_date")
        hist[c] = (g["snapshot_date"].to_numpy(), g["rating"].to_numpy(dtype=float))
    return hist, set(hist)


def rating_at(hist: dict, team: str, d: np.datetime64, interp: bool = False) -> float | None:
    """Last snapshot STRICTLY before d (leak-free). interp=True = linear interpolation
    toward the NEXT snapshot — LEAKY, diagnostic only (spec §2.2.2)."""
    dates, ratings = hist[team]
    i = int(np.searchsorted(dates, d))          # first index with dates[i] >= d
    if i == 0:
        return None
    if not interp or i >= len(dates):
        return float(ratings[i - 1])
    t0, t1 = dates[i - 1], dates[i]
    frac = float((d - t0) / (t1 - t0))
    return float(ratings[i - 1] + frac * (ratings[i] - ratings[i - 1]))


def load_matches() -> pd.DataFrame:
    res = pd.read_csv(RESULTS_CSV)
    missing = REQUIRED_COLS - set(res.columns)
    if missing:
        raise ValueError(f"TA3: results.csv missing columns {sorted(missing)}")
    res["date"] = pd.to_datetime(res["date"])
    # era window + drop unplayed rows (the file ships future WC2026 fixtures with NA scores)
    res = res[(res["date"] >= ERA_START) & (res["date"] <= VAL_END)]
    res = res.dropna(subset=["home_score", "away_score"]).copy()
    res["home_elo"] = res["home_team"].map(lambda n: MANUAL_NAMES.get(n, n))
    res["away_elo"] = res["away_team"].map(lambda n: MANUAL_NAMES.get(n, n))
    return res


def build_sample(res: pd.DataFrame, hist: dict, elo48: set[str], interp: bool = False) -> tuple[pd.DataFrame, dict]:
    """Matches with both teams in the 48 + both pre-match snapshots. One row per match."""
    # silent-mapping-miss guard: every WC2026 team must appear plenty in the FULL era
    # dataset (a missed spelling shows ~0 here; thinness in the both-in-48 sample is
    # legitimate for debutant minnows — e.g. Curaçao: 118 era matches but only 19 vs
    # the other 47 — and is reported, not failed).
    counts_all = pd.concat([res["home_elo"], res["away_elo"]]).value_counts()
    unmapped = [t for t in sorted(elo48) if counts_all.get(t, 0) < MIN_MATCHES_PER_TEAM]
    if unmapped:
        raise ValueError(
            f"TA3: teams with <{MIN_MATCHES_PER_TEAM} matches in the full era dataset — "
            f"name-mapping miss: {unmapped}"
        )

    both = res[res["home_elo"].isin(elo48) & res["away_elo"].isin(elo48)].copy()

    rows, dropped = [], 0
    for m in both.itertuples():
        d = np.datetime64(m.date)
        eh = rating_at(hist, m.home_elo, d, interp)
        ea = rating_at(hist, m.away_elo, d, interp)
        if eh is None or ea is None:
            dropped += 1
            continue
        if not interp:                      # TA3 zero-leakage hard assert
            dates_h, _ = hist[m.home_elo]
            i = int(np.searchsorted(dates_h, d))
            assert i > 0 and dates_h[i - 1] < d, "leakage: snapshot not strictly pre-match"
        rows.append({
            "date": m.date, "home": m.home_elo, "away": m.away_elo,
            "elo_home": eh, "elo_away": ea,
            "hg": int(m.home_score), "ag": int(m.away_score),
            "neutral": bool(m.neutral), "friendly": int(m.tournament == "Friendly"),
            "tournament": m.tournament,
        })
    df = pd.DataFrame(rows)
    drop_rate = dropped / max(len(both), 1)
    if drop_rate >= MAX_DROP_RATE:
        raise ValueError(f"TA3: snapshot drop rate {drop_rate:.1%} >= {MAX_DROP_RATE:.0%}")
    if len(df) < MIN_MATCHES:
        raise ValueError(f"TA3: n_matches {len(df)} < {MIN_MATCHES}")
    meta = {"n_candidates": int(len(both)), "n_dropped_snapshot": dropped, "drop_rate": drop_rate}
    return df, meta


def team_rows(df: pd.DataFrame, ref_date: pd.Timestamp, half_life: float | None) -> pd.DataFrame:
    """Two GLM rows per match (team view) with signed home indicator + decay weights."""
    sign = (~df["neutral"]).astype(int)     # martj42: non-neutral => home_team at home
    dy = (ref_date - df["date"]).dt.days / 365.25
    w = np.ones(len(df)) if half_life is None else 0.5 ** (dy / half_life)
    home = pd.DataFrame({
        "y": df["hg"], "delo400": (df["elo_home"] - df["elo_away"]) / 400.0,
        "home_sign": sign, "friendly": df["friendly"], "w": w, "match": df.index,
    })
    away = pd.DataFrame({
        "y": df["ag"], "delo400": (df["elo_away"] - df["elo_home"]) / 400.0,
        "home_sign": -sign, "friendly": df["friendly"], "w": w, "match": df.index,
    })
    return pd.concat([home, away], ignore_index=True)


# ---------- stage 1: Poisson GLM ----------

def fit_glm(rows: pd.DataFrame) -> dict:
    import statsmodels.api as sm
    X = sm.add_constant(rows[["delo400", "home_sign", "friendly"]])
    glm = sm.GLM(rows["y"], X, family=sm.families.Poisson(), freq_weights=rows["w"].to_numpy())
    try:
        fit = glm.fit(cov_type="cluster", cov_kwds={"groups": rows["match"].to_numpy()})
        cov_note = "match-clustered robust SE"
    except Exception as e:                  # pragma: no cover — fallback, noted in report
        fit = glm.fit()
        cov_note = f"default SE (cluster failed: {e})"
    a, b, h, f = (fit.params[k] for k in ("const", "delo400", "home_sign", "friendly"))
    se = {k: float(fit.bse[k]) for k in ("const", "delo400", "home_sign", "friendly")}
    return {
        "BASE": float(np.exp(a)), "GAMMA": float(b),
        "HFA_ELO": float(400.0 * h / b),    # exact mapping (spec §2.2.3, review R2)
        "eta": float(h), "friendly_coef": float(f),
        "se": se, "cov_note": cov_note, "n_rows": int(len(rows)),
    }


def fit_asymmetry(rows: pd.DataFrame) -> dict:
    """Diagnostic: unconstrained home-attack vs away-suppression (spec §2.2.3)."""
    import statsmodels.api as sm
    r = rows.copy()
    r["home_att"] = (r["home_sign"] > 0).astype(int)
    r["home_def"] = (r["home_sign"] < 0).astype(int)
    X = sm.add_constant(r[["delo400", "home_att", "home_def", "friendly"]])
    fit = sm.GLM(r["y"], X, family=sm.families.Poisson(), freq_weights=r["w"].to_numpy()).fit()
    return {"h_att": float(fit.params["home_att"]), "h_def": float(fit.params["home_def"])}


# ---------- stage 2: RHO profile likelihood ----------

def lambdas_for(df: pd.DataFrame, p: dict) -> tuple[np.ndarray, np.ndarray]:
    """Candidate-model λs for whole matches (deployment formula, friendly term included
    for historical rows; WC application uses friendly=0)."""
    d = (df["elo_home"] - df["elo_away"]) / 400.0
    sign = (~df["neutral"]).astype(int)
    hfa = p["GAMMA"] * p["HFA_ELO"] / 400.0 * sign
    fr = p["friendly_coef"] * df["friendly"]
    lh = p["BASE"] * np.exp(p["GAMMA"] * d + hfa + fr)
    la = p["BASE"] * np.exp(-p["GAMMA"] * d - hfa + fr)
    return lh.to_numpy(), la.to_numpy()


def fit_rho(df: pd.DataFrame, lh: np.ndarray, la: np.ndarray, w: np.ndarray) -> float:
    """Profile likelihood: only the four τ cells depend on ρ (Poisson terms constant)."""
    hg, ag = df["hg"].to_numpy(), df["ag"].to_numpy()
    low = (hg <= 1) & (ag <= 1)
    i, j = hg[low], ag[low]
    lhl, lal, wl = lh[low], la[low], w[low]
    best_rho, best_ll = None, -np.inf
    for rho in RHO_GRID:
        tau = np.ones(len(i))
        tau[(i == 0) & (j == 0)] = 1.0 - (lhl * lal * rho)[(i == 0) & (j == 0)]
        tau[(i == 0) & (j == 1)] = 1.0 + (lhl * rho)[(i == 0) & (j == 1)]
        tau[(i == 1) & (j == 0)] = 1.0 + (lal * rho)[(i == 1) & (j == 0)]
        tau[(i == 1) & (j == 1)] = 1.0 - rho
        if (tau <= 0).any():                # T2 guard: invalid ρ for this λ range
            continue
        ll = float((wl * np.log(tau)).sum())
        if ll > best_ll:
            best_rho, best_ll = float(rho), ll
    if best_rho is None:
        raise ValueError("no valid RHO in grid (T2 guard)")
    return best_rho


# ---------- evaluation ----------

def match_probs(lh: float, la: float, rho: float, maxg: int = MAXG) -> tuple[float, float, float, float]:
    """(p_home, p_draw, p_away, p_over_2_5) from the τ-corrected normalized matrix."""
    g = np.arange(maxg + 1)
    M = np.outer(poisson.pmf(g, lh), poisson.pmf(g, la))
    M[0, 0] *= 1.0 - lh * la * rho
    M[0, 1] *= 1.0 + lh * rho
    M[1, 0] *= 1.0 + la * rho
    M[1, 1] *= 1.0 - rho
    M /= M.sum()
    p_home = float(np.tril(M, -1).sum())    # rows = home goals: i > j
    p_draw = float(np.trace(M))
    p_away = float(np.triu(M, 1).sum())
    p_o25 = float(M[np.add.outer(g, g) >= 3].sum())
    return p_home, p_draw, p_away, p_o25


def score_1x2(df: pd.DataFrame, lh: np.ndarray, la: np.ndarray, rho: float) -> dict:
    ll = br = br_tot = 0.0
    n = len(df)
    for k, m in enumerate(df.itertuples()):
        ph, pd_, pa, po = match_probs(lh[k], la[k], rho)
        out = "home" if m.hg > m.ag else ("away" if m.hg < m.ag else "draw")
        probs = {"home": ph, "draw": pd_, "away": pa}
        ll += -np.log(max(probs[out], EPS))
        br += sum((probs[o] - (1.0 if o == out else 0.0)) ** 2 for o in probs)
        actual_over = 1.0 if (m.hg + m.ag) >= 3 else 0.0
        br_tot += (po - actual_over) ** 2
    return {"log_loss": ll / n, "brier": br / n, "brier_totals25": br_tot / n, "n": n}


def lambdas_v10(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """dc-v1.0 prior baseline, its HFA prior applied on non-neutral matches."""
    d = (df["elo_home"] - df["elo_away"]) / 400.0
    sign = (~df["neutral"]).astype(int)
    hfa = dc_engine.GAMMA * dc_engine.HFA_ELO / 400.0 * sign
    lh = dc_engine.BASE * np.exp(dc_engine.GAMMA * d + hfa)
    la = dc_engine.BASE * np.exp(-dc_engine.GAMMA * d - hfa)
    return lh.to_numpy(), la.to_numpy()


def score_we_baseline(df: pd.DataFrame, draw_rate: float) -> dict:
    """Elo We curve + fixed draw model (spec §2.2.4 baseline b)."""
    ll = br = 0.0
    n = len(df)
    for m in df.itertuples():
        d = m.elo_home - m.elo_away + (0.0 if m.neutral else 100.0)
        we = 1.0 / (1.0 + 10.0 ** (-d / 400.0))
        ph = max(we - draw_rate / 2.0, EPS)
        pa = max(1.0 - we - draw_rate / 2.0, EPS)
        s = ph + pa + draw_rate
        probs = {"home": ph / s, "draw": draw_rate / s, "away": pa / s}
        out = "home" if m.hg > m.ag else ("away" if m.hg < m.ag else "draw")
        ll += -np.log(max(probs[out], EPS))
        br += sum((probs[o] - (1.0 if o == out else 0.0)) ** 2 for o in probs)
    return {"log_loss": ll / n, "brier": br / n, "n": n}


def we_anchors(p: dict, rho: float) -> dict:
    """T9 diagnostic (NOT a gate for v1.1): neutral We at Elo diff 100/200/400."""
    out = {}
    for diff, anchor in [(100, 0.64), (200, 0.76), (400, 0.91)]:
        lh = p["BASE"] * np.exp(p["GAMMA"] * diff / 400.0)
        la = p["BASE"] * np.exp(-p["GAMMA"] * diff / 400.0)
        ph, pdr, pa, _ = match_probs(lh, la, rho)
        out[diff] = {"we": ph + 0.5 * pdr, "anchor": anchor, "dev": ph + 0.5 * pdr - anchor}
    return out


def round_trip_check(p: dict) -> None:
    """TA7: engine formula with fitted constants must reproduce the GLM λs exactly."""
    old = (dc_engine.BASE, dc_engine.GAMMA, dc_engine.HFA_ELO)
    try:
        dc_engine.BASE, dc_engine.GAMMA, dc_engine.HFA_ELO = p["BASE"], p["GAMMA"], p["HFA_ELO"]
        for eh, ea, host_home, host_away in [(1600.0, 1500.0, True, False),
                                             (1500.0, 1700.0, False, True),
                                             (1500.0, 1500.0, False, False)]:
            lh_e, la_e = dc_engine.elo_to_lambdas(eh, ea, host_home, host_away)
            sign = 1 if host_home else (-1 if host_away else 0)
            d = (eh - ea) / 400.0
            adj = p["GAMMA"] * p["HFA_ELO"] / 400.0 * sign
            lh_g = p["BASE"] * np.exp(p["GAMMA"] * d + adj)
            la_g = p["BASE"] * np.exp(-p["GAMMA"] * d - adj)
            assert abs(lh_e - lh_g) < 1e-9 and abs(la_e - la_g) < 1e-9, \
                f"TA7 round-trip failed: engine ({lh_e},{la_e}) vs GLM ({lh_g},{la_g})"
    finally:
        dc_engine.BASE, dc_engine.GAMMA, dc_engine.HFA_ELO = old


def et_contamination(df: pd.DataFrame) -> dict:
    """Lower bound via shootouts.csv: those matches definitely had extra time."""
    so = pd.read_csv(SHOOTOUTS_CSV)
    so["date"] = pd.to_datetime(so["date"])
    so["home_elo"] = so["home_team"].map(lambda n: MANUAL_NAMES.get(n, n))
    so["away_elo"] = so["away_team"].map(lambda n: MANUAL_NAMES.get(n, n))
    keys = set(zip(so["date"], so["home_elo"], so["away_elo"]))
    hits = sum(1 for m in df.itertuples() if (m.date, m.home, m.away) in keys)
    return {"n_shootout_matches": hits, "share": hits / max(len(df), 1)}


# ---------- main ----------

def run() -> dict:
    print("P6 A2 — Dixon-Coles historical fit (offline, no DB)")
    hist, elo48 = load_elo_history()
    if len(elo48) != 48:
        raise ValueError(f"TA3: Elo history has {len(elo48)} teams, expected 48")
    res = load_matches()
    df, meta = build_sample(res, hist, elo48)
    train = df[df["date"] <= TRAIN_END].reset_index(drop=True)
    val = df[df["date"] > TRAIN_END].reset_index(drop=True)
    print(f"  sample: {len(df)} matches ({meta['n_dropped_snapshot']} dropped for missing "
          f"snapshot, {meta['drop_rate']:.2%}); train {len(train)} / validation {len(val)}")

    # --- half-life selection on validation 1X2 log-loss (spec §2.2.3) ---
    results_by_hl = {}
    for hl in HALF_LIVES:
        rows = team_rows(train, pd.Timestamp(TRAIN_END), hl)
        p = fit_glm(rows)
        lh_t, la_t = lambdas_for(train, p)
        rho = fit_rho(train, lh_t, la_t, rows["w"].to_numpy()[: len(train)])
        lh_v, la_v = lambdas_for(val, p)
        scores = score_1x2(val, lh_v, la_v, rho)
        results_by_hl[hl] = {"params": p, "rho": rho, "val": scores}
        print(f"  HL={hl}: BASE={p['BASE']:.3f} GAMMA={p['GAMMA']:.3f} "
              f"HFA={p['HFA_ELO']:.0f} RHO={rho:+.2f} | val log-loss {scores['log_loss']:.4f}")
    best_hl = min(results_by_hl, key=lambda k: results_by_hl[k]["val"]["log_loss"])
    cand = results_by_hl[best_hl]

    # --- baselines on the same validation set (spec §2.2.4) ---
    lh10, la10 = lambdas_v10(val)
    base_v10 = score_1x2(val, lh10, la10, dc_engine.RHO)
    draw_rate = float((train["hg"] == train["ag"]).mean())
    base_we = score_we_baseline(val, draw_rate)

    gate_pass = cand["val"]["log_loss"] < base_v10["log_loss"]

    # --- diagnostics ---
    rows_best = team_rows(train, pd.Timestamp(TRAIN_END), best_hl)
    asym = fit_asymmetry(rows_best)
    sens_rows = team_rows(*_interp_sample(res, hist, elo48), best_hl)  # leaky variant
    sens = fit_glm(sens_rows)
    anchors = we_anchors(cand["params"], cand["rho"])
    et = et_contamination(df)
    confed = _confed_balance(df)
    round_trip_check(cand["params"])
    print(f"  TA7 round-trip: PASS")

    # --- deployed params: full-window refit with the selected half-life ---
    rows_full = team_rows(df.reset_index(drop=True), pd.Timestamp(VAL_END), best_hl)
    deployed = fit_glm(rows_full)
    lh_f, la_f = lambdas_for(df.reset_index(drop=True), deployed)
    deployed_rho = fit_rho(df.reset_index(drop=True), lh_f, la_f,
                           rows_full["w"].to_numpy()[: len(df)])
    round_trip_check(deployed)

    report = {
        "meta": meta, "n_train": len(train), "n_val": len(val),
        "best_half_life": best_hl, "candidate": cand,
        "baseline_v10": base_v10, "baseline_we": base_we,
        "gate_pass": gate_pass, "asymmetry": asym, "sensitivity_interp": sens,
        "anchors": anchors, "et": et, "confed": confed, "draw_rate_train": draw_rate,
        "deployed": {"params": deployed, "rho": deployed_rho},
        "by_half_life": {str(k): {"val_log_loss": v["val"]["log_loss"]} for k, v in results_by_hl.items()},
    }
    REPORT_PATH.write_text(_render(report))
    print(f"  gate (val 1X2 log-loss): candidate {cand['val']['log_loss']:.4f} vs "
          f"dc-v1.0 {base_v10['log_loss']:.4f} vs We {base_we['log_loss']:.4f} "
          f"-> {'PASS' if gate_pass else 'FAIL (no bump)'}")
    print(f"  deployed (full refit, HL={best_hl}): BASE={deployed['BASE']:.4f} "
          f"GAMMA={deployed['GAMMA']:.4f} HFA_ELO={deployed['HFA_ELO']:.1f} RHO={deployed_rho:+.2f}")
    print(f"  report -> {REPORT_PATH}")
    return report


def _interp_sample(res, hist, elo48):
    df, _meta = build_sample(res, hist, elo48, interp=True)
    return df[df["date"] <= TRAIN_END].reset_index(drop=True), pd.Timestamp(TRAIN_END)


def _confed_balance(df: pd.DataFrame) -> dict:
    elo = pd.read_csv(ELO_CSV)
    conf = elo.drop_duplicates("country").set_index("country")["confederation"].to_dict()
    counts: dict[str, int] = {}
    for m in df.itertuples():
        for t in (m.home, m.away):
            c = conf.get(t, "?")
            counts[c] = counts.get(c, 0) + 1
    return counts


def _render(r: dict) -> str:
    p, d = r["candidate"]["params"], r["deployed"]["params"]
    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%MZ")
    L = [
        "# Dixon-Coles historical fit — REPORT (P6 A2)", "",
        f"Generated {gen} by `fit/fit_dc.py`. Data: martj42 intl results (CC0, "
        f"see etl/data/raw/intl_results/README.md) + Elo yearly snapshots.",
        "",
        "## Sample",
        f"- era {ERA_START} .. {VAL_END}, both teams in the WC2026 48",
        f"- candidates {r['meta']['n_candidates']}, dropped (missing pre-match snapshot) "
        f"{r['meta']['n_dropped_snapshot']} ({r['meta']['drop_rate']:.2%}) — guard <5% PASS",
        f"- train (≤{TRAIN_END}) n={r['n_train']}; validation n={r['n_val']}",
        f"- confederation balance (team-rows): {r['confed']}",
        f"- ET contamination lower bound (shootout matches in sample): "
        f"{r['et']['n_shootout_matches']} ({r['et']['share']:.2%}) — accepted, spec §2.2.6 #3",
        "",
        "## Half-life selection (validation 1X2 log-loss)",
    ]
    for k, v in r["by_half_life"].items():
        mark = " <- selected" if k == str(r["best_half_life"]) else ""
        L.append(f"- HL={k}: {v['val_log_loss']:.4f}{mark}")
    L += [
        "",
        "## Gate (spec §2.2.4 — candidate is the TRAIN-fitted model)",
        "",
        "| model | val 1X2 log-loss | val 1X2 Brier | val totals2.5 Brier |",
        "|---|---|---|---|",
        f"| candidate (HL={r['best_half_life']}) | {r['candidate']['val']['log_loss']:.4f} "
        f"| {r['candidate']['val']['brier']:.4f} | {r['candidate']['val']['brier_totals25']:.4f} |",
        f"| dc-v1.0 priors | {r['baseline_v10']['log_loss']:.4f} "
        f"| {r['baseline_v10']['brier']:.4f} | {r['baseline_v10']['brier_totals25']:.4f} |",
        f"| Elo We + fixed draw ({r['draw_rate_train']:.3f}) | {r['baseline_we']['log_loss']:.4f} "
        f"| {r['baseline_we']['brier']:.4f} | — |",
        "",
        f"**GATE: {'PASS' if r['gate_pass'] else 'FAIL — do NOT bump'}** "
        "(both baselines are Elo-derived — circularity trap #11; the only external "
        "reference is the A3 market diagnosis, see fit/DIAGNOSIS.md)",
        "",
        "## Parameters",
        "",
        "| | BASE | GAMMA | HFA_ELO | RHO | friendly |",
        "|---|---|---|---|---|---|",
        f"| candidate (train, gate) | {p['BASE']:.4f} | {p['GAMMA']:.4f} | {p['HFA_ELO']:.1f} "
        f"| {r['candidate']['rho']:+.2f} | {p['friendly_coef']:+.4f} |",
        f"| **deployed (full refit)** | {d['BASE']:.4f} | {d['GAMMA']:.4f} | {d['HFA_ELO']:.1f} "
        f"| {r['deployed']['rho']:+.2f} | {d['friendly_coef']:+.4f} |",
        "",
        f"SEs ({d['cov_note']}): " + ", ".join(f"{k}={v:.4f}" for k, v in d["se"].items()),
        "",
        "Impl note: the gate is decided on the train-fitted candidate; the deployed",
        "constants are a full-window refit with the selected half-life (uses the most",
        "recent 2.5y of data; standard practice, documented per spec §2.2.5).",
        "",
        "## Diagnostics",
        f"- asymmetry (unconstrained): h_att={r['asymmetry']['h_att']:+.4f}, "
        f"h_def={r['asymmetry']['h_def']:+.4f} (engine assumes h_def = −h_att)",
        f"- attenuation sensitivity (LEAKY interpolated variant, diagnostic only): "
        f"GAMMA {r['sensitivity_interp']['GAMMA']:.4f} vs candidate {p['GAMMA']:.4f}",
        "- T9 We anchors (diagnostic for v1.1, NOT a gate — spec §2.2.4):",
    ]
    for diff, a in r["anchors"].items():
        flag = " ⚠️ >±0.05" if abs(a["dev"]) > 0.05 else ""
        L.append(f"  - diff {diff}: We={a['we']:.3f} vs anchor {a['anchor']:.2f} "
                 f"(dev {a['dev']:+.3f}){flag}")
    L += ["", "TA7 round-trip (engine ≡ GLM mapping): PASS for candidate + deployed.", ""]
    return "\n".join(L)


if __name__ == "__main__":
    run()
