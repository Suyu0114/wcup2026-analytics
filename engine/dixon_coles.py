"""Dixon–Coles Poisson prediction engine (P1 spec §5; constants fitted in P6 A2).

Pure functions, no I/O — everything here is offline-testable. Pipeline:
Elo -> expected goals λ (log-linear, always positive) -> Dixon–Coles score
matrix -> 1X2 / Over-2.5 / BTTS probabilities.
"""
from __future__ import annotations

import math

from scipy.stats import poisson

MODEL_VERSION = "dc-v1.1"

# FITTED constants (P6 A2) — no longer the §5.0 priors.
# Provenance: fit/fit_dc.py — martj42 intl results (CC0) × Elo yearly snapshots
# (pre-match snapshot only, zero leakage); era 2010-01-01..2026-06-08, n=1932
# matches between WC2026-qualified teams; time-decay half-life 2y; deployed =
# full-window refit. Gate: validation 1X2 log-loss 1.0492 vs v1.0 priors 1.1239
# (PASS). Full diagnostics: fit/REPORT.md (2026-06-10).
# dc-v1.0 priors were BASE 1.35 / GAMMA 0.90 / HFA 100 / RHO -0.10 (kept in
# tests/test_engine.py T9, which anchors the v1.0 prior design).
BASE = 1.2014     # baseline goals per team
GAMMA = 0.5478    # Elo -> λ strength (prior 0.90 over-amplified favorites — see A3)
HFA_ELO = 84.5    # host home advantage in Elo points; only when is_host_home/away
RHO = -0.12       # Dixon–Coles low-score correction
MAXG = 10         # score-matrix upper bound (goals per team)


def elo_to_lambdas(
    elo_home: float, elo_away: float, is_host_home: bool, is_host_away: bool = False
) -> tuple[float, float]:
    """Elo -> (λ_home, λ_away). Log-linear so both stay > 0 (spec §5.1).

    HFA only for a host nation playing in its own country; neutral venue => 0.
    It shifts the Elo difference d symmetrically, so it works for either listed
    side: football-data lists the hosts as the AWAY team in their third group
    games (e.g. Czechia v Mexico at Azteca) — is_host_away applies −HFA to d
    (P6 spec §2.1 impl note).
    """
    ha = (HFA_ELO if is_host_home else 0.0) - (HFA_ELO if is_host_away else 0.0)
    d = (elo_home + ha - elo_away) / 400.0
    lam_home = BASE * math.exp(+GAMMA * d)
    lam_away = BASE * math.exp(-GAMMA * d)
    return lam_home, lam_away


def tau(i: int, j: int, lh: float, la: float, rho: float) -> float:
    """Dixon–Coles low-score dependency correction (spec §5.2)."""
    if i == 0 and j == 0:
        return 1.0 - lh * la * rho
    if i == 0 and j == 1:
        return 1.0 + lh * rho
    if i == 1 and j == 0:
        return 1.0 + la * rho
    if i == 1 and j == 1:
        return 1.0 - rho
    return 1.0


def score_matrix(lh: float, la: float, rho: float = RHO, maxg: int = MAXG) -> list[list[float]]:
    """Normalized P[i][j] = P(home scores i, away scores j) over 0..maxg (spec §5.2)."""
    P = [[0.0] * (maxg + 1) for _ in range(maxg + 1)]
    for i in range(maxg + 1):
        for j in range(maxg + 1):
            P[i][j] = poisson.pmf(i, lh) * poisson.pmf(j, la) * tau(i, j, lh, la, rho)
    s = sum(P[i][j] for i in range(maxg + 1) for j in range(maxg + 1))
    return [[P[i][j] / s for j in range(maxg + 1)] for i in range(maxg + 1)]


def derive(P: list[list[float]], maxg: int = MAXG) -> tuple[float, float, float, float, float]:
    """matrix -> (p_home, p_draw, p_away, p_over_2_5, p_btts) (spec §5.2)."""
    rng = range(maxg + 1)
    p_home = sum(P[i][j] for i in rng for j in rng if i > j)
    p_draw = sum(P[i][j] for i in rng for j in rng if i == j)
    p_away = sum(P[i][j] for i in rng for j in rng if i < j)
    p_o25 = sum(P[i][j] for i in rng for j in rng if i + j >= 3)
    p_btts = sum(P[i][j] for i in rng for j in rng if i >= 1 and j >= 1)
    return p_home, p_draw, p_away, p_o25, p_btts


def predict_match(
    elo_home: float, elo_away: float, is_host_home: bool = False, is_host_away: bool = False
) -> dict:
    """Full engine output for one match (spec §5.3 fields). Native floats for JSON/DB."""
    lh, la = elo_to_lambdas(elo_home, elo_away, is_host_home, is_host_away)
    p_home, p_draw, p_away, p_o25, p_btts = derive(score_matrix(lh, la))
    return {
        "model_version": MODEL_VERSION,
        "lambda_home": float(lh),
        "lambda_away": float(la),
        "p_home": float(p_home),
        "p_draw": float(p_draw),
        "p_away": float(p_away),
        "p_over_2_5": float(p_o25),
        "p_btts": float(p_btts),
        "exp_total_goals": float(lh + la),
    }
