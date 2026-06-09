"""Calibration scoring (spec §6 / T10) — pure, offline."""
import math

import pytest

from etl.calibrate import brier, log_loss, result_1x2


def test_result_1x2():
    assert result_1x2(2, 1) == "home"
    assert result_1x2(0, 3) == "away"
    assert result_1x2(1, 1) == "draw"


def test_brier_perfect_and_worst():
    assert brier({"home": 1.0, "draw": 0.0, "away": 0.0}, "home") == pytest.approx(0.0)
    assert brier({"home": 0.0, "draw": 0.0, "away": 1.0}, "home") == pytest.approx(2.0)


def test_brier_known_value():
    # (.5-1)^2 + .3^2 + .2^2 = .25 + .09 + .04 = .38
    assert brier({"home": 0.5, "draw": 0.3, "away": 0.2}, "home") == pytest.approx(0.38)


def test_log_loss_known_value():
    assert log_loss({"home": 0.5, "draw": 0.3, "away": 0.2}, "home") == pytest.approx(-math.log(0.5))
