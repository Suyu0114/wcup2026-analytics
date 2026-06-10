# Dixon-Coles historical fit — REPORT (P6 A2)

Generated 2026-06-10 16:10Z by `fit/fit_dc.py`. Data: martj42 intl results (CC0, see etl/data/raw/intl_results/README.md) + Elo yearly snapshots.

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

The gate is **comparative** (is the fitted model *less wrong* than the v1.0 prior?), not a measure of absolute skill. The coin-flip row is the data-independent 1X2 floor (uniform 1/3); read the others against it.

| model | val 1X2 log-loss | val 1X2 Brier | val totals2.5 Brier |
|---|---|---|---|
| candidate (HL=2.0) | 1.0492 | 0.6359 | 0.2515 |
| dc-v1.0 priors | 1.1239 | 0.6714 | 0.2685 |
| Elo We + fixed draw (0.240) | 1.3816 | 0.6473 | — |
| coin-flip (uniform 1/3) | 1.0986 | 0.6667 | — |

**GATE: PASS** (both baselines are Elo-derived — circularity trap #11; the only external reference is the A3 market diagnosis, see fit/DIAGNOSIS.md)

**Interpretation.** Two things are true at once, and both matter:
- The bump is correct: dc-v1.0 priors lose to a coin flip on **both** metrics (log-loss 1.1239 vs 1.0986, Brier 0.6714 vs 0.6667) — i.e. v1.0 was confidently miscalibrated (GAMMA 0.90 + too many goals). The fitted model beats both the prior and the coin flip, so the gate passes for a real reason.
- The absolute skill is modest by design: the candidate clears the coin flip by only ~0.05 nats. International 1X2 from an Elo-difference-only model is near the ceiling of what ratings alone can predict. This is exactly why the product keeps the model EXPERIMENTAL, defaults to the market, and leaves model-mode Kelly LOCKED until live in-tournament calibration (T10) earns it — the bump means *less wrong than the prior*, never *trustworthy enough to bet*.

## Parameters

| | BASE | GAMMA | HFA_ELO | RHO | friendly |
|---|---|---|---|---|---|
| candidate (train, gate) | 1.1816 | 0.5876 | 113.3 | -0.02 | +0.0983 |
| **deployed (full refit)** | 1.2014 | 0.5478 | 84.5 | -0.12 | +0.0685 |

SEs (match-clustered robust SE): const=0.0339, delo400=0.0504, home_sign=0.0329, friendly=0.0536

Impl note: the gate is decided on the train-fitted candidate; the deployed
constants are a full-window refit with the selected half-life (uses the most
recent 2.5y of data; standard practice, documented per spec §2.2.5). The deployed
GAMMA (0.5478) is *more conservative* than the gate-passing candidate's
(0.5876) — adding the recent window pulls favorites slightly less extreme,
not more; deployed was never re-gated (all data was used to fit it).

## Diagnostics
- asymmetry (unconstrained): h_att=+0.1591, h_def=-0.1751 (engine assumes h_def = −h_att)
- attenuation sensitivity (LEAKY interpolated variant, diagnostic only): GAMMA 0.7285 vs candidate 0.5876
- T9 We anchors (diagnostic for v1.1, NOT a gate — spec §2.2.4):
  - diff 100: We=0.584 vs anchor 0.64 (dev -0.056) (>±0.05)
  - diff 200: We=0.665 vs anchor 0.76 (dev -0.095) (>±0.05)
  - diff 400: We=0.806 vs anchor 0.91 (dev -0.104) (>±0.05)
  - ⚠️ read these as corroboration, not a red flag: the deviations are all *negative* — the fitted model is **less** confident in strong favorites than the eloratings We curve. That curve is eloratings' own self-defined idealization, not ground truth (hence demoted to diagnostic for v1.1). The independent A3 market diagnosis points the SAME way — the sharp market also has v1.0 over-rating favorites and over-predicting goals (see fit/DIAGNOSIS.md). Two unrelated references agreeing that v1.0 was too aggressive is evidence the fit moved the right direction, not a warning. (Part of the gap is also attenuation — stale pre-match Elo biases GAMMA down; see the sensitivity row above.)

TA7 round-trip (engine ≡ GLM mapping): PASS for candidate + deployed.
