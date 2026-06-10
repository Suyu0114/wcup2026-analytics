# Dixon-Coles historical fit — REPORT (P6 A2)

Generated 2026-06-10 05:04Z by `fit/fit_dc.py`. Data: martj42 intl results (CC0, see etl/data/raw/intl_results/README.md) + Elo yearly snapshots.

## Sample
- era 2010-01-01 .. 2026-06-08, both teams in the WC2026 48
- candidates 1932, dropped (missing pre-match snapshot) 0 (0.00%) — guard <5% PASS
- train (≤2023-12-31) n=1628; validation n=304
- confederation balance (team-rows): {'CAF': 580, 'AFC': 805, 'UEFA': 1279, 'CONMEBOL': 672, 'CONCACAF': 491, 'OFC': 37}
- ET contamination lower bound (shootout matches in sample): 55 (2.85%) — accepted, spec §2.2.6 #3

## Half-life selection (validation 1X2 log-loss)
- HL=None: 1.0520
- HL=2.0: 1.0492 <- selected
- HL=4.0: 1.0507
- HL=8.0: 1.0513

## Gate (spec §2.2.4 — candidate is the TRAIN-fitted model)

| model | val 1X2 log-loss | val 1X2 Brier | val totals2.5 Brier |
|---|---|---|---|
| candidate (HL=2.0) | 1.0492 | 0.6359 | 0.2515 |
| dc-v1.0 priors | 1.1239 | 0.6714 | 0.2685 |
| Elo We + fixed draw (0.240) | 1.3816 | 0.6473 | — |

**GATE: PASS** (both baselines are Elo-derived — circularity trap #11; the only external reference is the A3 market diagnosis, see fit/DIAGNOSIS.md)

## Parameters

| | BASE | GAMMA | HFA_ELO | RHO | friendly |
|---|---|---|---|---|---|
| candidate (train, gate) | 1.1816 | 0.5876 | 113.3 | -0.02 | +0.0983 |
| **deployed (full refit)** | 1.2014 | 0.5478 | 84.5 | -0.12 | +0.0685 |

SEs (match-clustered robust SE): const=0.0339, delo400=0.0504, home_sign=0.0329, friendly=0.0536

Impl note: the gate is decided on the train-fitted candidate; the deployed
constants are a full-window refit with the selected half-life (uses the most
recent 2.5y of data; standard practice, documented per spec §2.2.5).

## Diagnostics
- asymmetry (unconstrained): h_att=+0.1591, h_def=-0.1751 (engine assumes h_def = −h_att)
- attenuation sensitivity (LEAKY interpolated variant, diagnostic only): GAMMA 0.7285 vs candidate 0.5876
- T9 We anchors (diagnostic for v1.1, NOT a gate — spec §2.2.4):
  - diff 100: We=0.584 vs anchor 0.64 (dev -0.056) ⚠️ >±0.05
  - diff 200: We=0.665 vs anchor 0.76 (dev -0.095) ⚠️ >±0.05
  - diff 400: We=0.806 vs anchor 0.91 (dev -0.104) ⚠️ >±0.05

TA7 round-trip (engine ≡ GLM mapping): PASS for candidate + deployed.
