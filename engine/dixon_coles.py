"""Dixon–Coles Poisson prediction engine (P1, spec §5).

Pure functions, no I/O — everything here is offline-testable. Pipeline:
Elo -> expected goals λ (log-linear, always positive) -> Dixon–Coles score
matrix -> 1X2 / Over-2.5 / BTTS probabilities.

⚠️ The constants below are PRIORS, not truth (spec §5.0): they let the engine
run and pass sanity tests (incl. the T9 We anchors). P3's backtest fits them
against historical results + closing odds. Don't treat them as calibrated.
"""
from __future__ import annotations

import math

from scipy.stats import poisson

MODEL_VERSION = "dc-v1.0"

# §5.0 calibration priors (to be fit in P3).
BASE = 1.35       # baseline goals per team (international average)
GAMMA = 0.90      # Elo -> λ strength
HFA_ELO = 100.0   # host home advantage in Elo points; applied only when is_host_home
RHO = -0.10       # Dixon–Coles low-score correction (small negative; too large -> negative probs)
MAXG = 10         # score-matrix upper bound (goals per team)


def elo_to_lambdas(elo_home: float, elo_away: float, is_host_home: bool) -> tuple[float, float]:
    """Elo -> (λ_home, λ_away). Log-linear so both stay > 0 (spec §5.1).

    HFA is applied only for a host nation playing at home; neutral venue => 0.
    """
    ha = HFA_ELO if is_host_home else 0.0
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


def predict_match(elo_home: float, elo_away: float, is_host_home: bool = False) -> dict:
    """Full engine output for one match (spec §5.3 fields). Native floats for JSON/DB."""
    lh, la = elo_to_lambdas(elo_home, elo_away, is_host_home)
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
