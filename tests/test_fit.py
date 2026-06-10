"""Guards for the historical fit (P6 A2). Offline — the big CSVs aren't needed here
(only the pure baseline function), so this runs without fit data.

Regression guard for the 2026-06-10 bug: the dc-v1.0 gate baseline read LIVE
engine constants, so once the engine was bumped to v1.1 the "v1.0 baseline"
silently became v1.1 and the gate compared the candidate against itself
(spurious FAIL). The baseline must be a FIXED reference.
"""
import numpy as np
import pandas as pd

import engine.dixon_coles as dc
from fit.fit_dc import V10_PRIORS, lambdas_v10


def test_v10_priors_are_the_documented_values():
    assert V10_PRIORS == {"BASE": 1.35, "GAMMA": 0.90, "HFA_ELO": 100.0, "RHO": -0.10}


def test_v10_baseline_independent_of_live_engine_constants(monkeypatch):
    df = pd.DataFrame(
        {"elo_home": [1800.0, 1500.0], "elo_away": [1500.0, 1800.0], "neutral": [True, False]}
    )
    before = lambdas_v10(df)
    # simulate a version bump corrupting the live engine globals
    monkeypatch.setattr(dc, "BASE", 99.0)
    monkeypatch.setattr(dc, "GAMMA", 99.0)
    monkeypatch.setattr(dc, "HFA_ELO", 9999.0)
    after = lambdas_v10(df)
    assert np.allclose(before[0], after[0])
    assert np.allclose(before[1], after[1])
