"""Dixon–Coles engine acceptance (spec §6: T1–T5, T8, T9) — pure, offline."""
import pytest

from engine.dixon_coles import elo_to_lambdas, predict_match, score_matrix

BASE_ELO = 1500.0


def test_t1_matrix_normalized():
    for lh, la in [(1.4, 1.0), (2.3, 0.6), (0.8, 0.8), (3.0, 2.5)]:
        P = score_matrix(lh, la)
        s = sum(P[i][j] for i in range(len(P)) for j in range(len(P)))
        assert abs(s - 1.0) < 1e-9


def test_t2_probabilities_nonnegative():
    for lh, la in [(1.4, 1.0), (2.3, 0.6), (0.5, 2.0)]:
        P = score_matrix(lh, la)
        assert all(P[i][j] >= 0.0 for i in range(len(P)) for j in range(len(P)))


def test_t3_1x2_sums_to_one():
    for diff in [0, 100, 300, 600]:
        out = predict_match(BASE_ELO + diff, BASE_ELO)
        assert abs(out["p_home"] + out["p_draw"] + out["p_away"] - 1.0) < 1e-6


def test_t4_symmetry_equal_elo_neutral():
    lh, la = elo_to_lambdas(BASE_ELO, BASE_ELO, is_host_home=False)
    assert abs(lh - la) < 1e-9
    out = predict_match(BASE_ELO, BASE_ELO, is_host_home=False)
    assert abs(out["p_home"] - out["p_away"]) < 1e-6


def test_t5_strength_direction():
    out = predict_match(BASE_ELO + 400, BASE_ELO)
    assert out["lambda_home"] > out["lambda_away"]
    assert out["p_home"] > 0.5 > out["p_away"]


def test_t8_host_advantage_switch():
    base = predict_match(BASE_ELO, BASE_ELO, is_host_home=False)
    host = predict_match(BASE_ELO, BASE_ELO, is_host_home=True)
    assert host["lambda_home"] > base["lambda_home"]   # HFA lifts home λ
    assert host["p_home"] > base["p_home"]


@pytest.mark.parametrize("diff,anchor", [(100, 0.64), (200, 0.76), (400, 0.91)])
def test_t9_we_calibration_anchors(diff, anchor):
    out = predict_match(BASE_ELO + diff, BASE_ELO, is_host_home=False)
    we = out["p_home"] + 0.5 * out["p_draw"]   # win expectancy, NOT p_home
    assert abs(we - anchor) <= 0.03, f"We={we:.3f} vs anchor {anchor} (diff {we - anchor:+.3f})"
