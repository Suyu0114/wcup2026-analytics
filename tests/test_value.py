"""EV / value calculator acceptance (spec §6: TV1–TV8) — pure, offline."""
import inspect

import pytest

from engine import value


def test_tv6_odds_format_to_decimal():
    assert value.to_decimal(2.50, "decimal") == pytest.approx(2.50)
    assert value.to_decimal(1.50, "hongkong") == pytest.approx(2.50)
    assert value.to_decimal(0.50, "hongkong") == pytest.approx(1.50)
    assert value.to_decimal(150, "american") == pytest.approx(2.50)
    assert value.to_decimal(-200, "american") == pytest.approx(1.50)
    assert value.to_decimal(1.50, "indonesian") == pytest.approx(2.50)
    assert value.to_decimal(-2.0, "indonesian") == pytest.approx(1.50)
    assert value.to_decimal(0.50, "malaysian") == pytest.approx(1.50)
    assert value.to_decimal(-0.50, "malaysian") == pytest.approx(3.00)


def test_tv6_decimal_must_exceed_one():
    with pytest.raises(ValueError):
        value.to_decimal(0.90, "decimal")
    with pytest.raises(ValueError):
        value.to_decimal(1.0, "decimal")


def test_de_vig_sums_to_one():
    # h2h three-way (TO4 shape) and totals two-way (TO5 shape)
    h = value.novig({"home": 2.0, "draw": 3.5, "away": 4.0})
    assert sum(h.values()) == pytest.approx(1.0)
    t = value.novig({"over": 1.91, "under": 1.95})
    assert sum(t.values()) == pytest.approx(1.0)


def test_tv1_ev_and_value_threshold():
    # p=0.55, d=2.0 -> EV = 0.10 (value); d=1.7 -> EV = -0.065 (no value)
    assert value.ev(0.55, 2.0) == pytest.approx(0.10)
    assert value.is_value(0.55, 2.0) is True
    assert value.ev(0.55, 1.7) == pytest.approx(-0.065)
    assert value.is_value(0.55, 1.7) is False


def test_tv3_kelly_formula_and_negative_zero():
    # f* = (d*p - 1)/(d - 1); quarter Kelly default
    assert value.kelly_fraction(0.55, 2.0) == pytest.approx(0.25 * 0.10)   # f*=0.10
    assert value.kelly_fraction(0.55, 1.7) == 0.0                           # negative EV -> 0
    assert value.kelly_fraction(0.60, 2.0, fraction=1.0) == pytest.approx(0.20)


def test_tv2_line_mismatch_no_value():
    r = value.evaluate(0.52, 1.95, "decimal", point=3.0, pinnacle_main_point=2.25)
    assert r["line_mismatch"] is True
    assert r["ev"] is None and r["value"] is None and r["kelly_fraction"] is None


def test_tv8_quarter_line_flagged_approximate():
    r_q = value.evaluate(0.52, 1.95, "decimal", point=2.25, pinnacle_main_point=2.25)
    assert r_q["line_mismatch"] is False and r_q["approximate"] is True
    r_h = value.evaluate(0.52, 1.95, "decimal", point=2.5, pinnacle_main_point=2.5)
    assert r_h["approximate"] is False


def test_tv7_best_available_within_line():
    # caller passes one outcome at one line; pick max decimal price
    book, price = value.best_available({"pinnacle": 1.91, "draftkings": 1.95, "betmgm": 1.88})
    assert book == "draftkings" and price == pytest.approx(1.95)


def test_tv4_isolation_value_takes_only_market_prob():
    # No function in the value path accepts a model probability.
    for fn in (value.ev, value.is_value, value.kelly_fraction, value.evaluate):
        params = set(inspect.signature(fn).parameters)
        assert not any("model" in p for p in params)
    src = inspect.getsource(value)
    assert "dixon_coles" not in src and "match_predictions" not in src
