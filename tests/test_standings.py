"""Group-stage display-standings tests (P8) — pure, offline.

Covers accumulation, the Pts→GD→GF→H2H tiebreaker, the honest "tied" fallback
(including a full A>B>C>A head-to-head cycle), and the pre-tournament zero state.
Deterministic: no Elo, no randomness (unlike group_sim.rank_group).
"""
from __future__ import annotations

import pytest

from engine.standings import StandingRow, compute_group_standings


def _by_id(rows: list[StandingRow]) -> dict[str, StandingRow]:
    return {r.team_id: r for r in rows}


def _order(rows: list[StandingRow]) -> list[str]:
    return [r.team_id for r in rows]


# ---------------------------------------------------------------------------
# Accumulation
# ---------------------------------------------------------------------------

def test_accumulates_pts_wdl_goals_including_draw():
    rows = compute_group_standings(
        ["A", "B", "C", "D"],
        [
            ("A", "B", 2, 2),   # draw
            ("A", "C", 3, 1),   # A win
        ],
    )
    d = _by_id(rows)
    assert (d["A"].played, d["A"].wins, d["A"].draws, d["A"].losses) == (2, 1, 1, 0)
    assert (d["A"].gf, d["A"].ga, d["A"].gd, d["A"].pts) == (5, 3, 2, 4)
    assert (d["B"].played, d["B"].draws, d["B"].pts, d["B"].gf, d["B"].ga) == (1, 1, 1, 2, 2)
    assert (d["C"].played, d["C"].losses, d["C"].pts, d["C"].gf, d["C"].ga) == (1, 1, 0, 1, 3)
    # untouched team still appears on zero
    assert (d["D"].played, d["D"].pts) == (0, 0)


def test_only_supplied_matches_counted():
    # The caller filters to finished matches; the engine counts exactly what it's given.
    rows = compute_group_standings(["A", "B"], [("A", "B", 1, 0)])
    d = _by_id(rows)
    assert d["A"].played == 1 and d["B"].played == 1


def test_unknown_team_is_fail_loud():
    with pytest.raises(ValueError):
        compute_group_standings(["A", "B"], [("A", "Z", 1, 0)])


# ---------------------------------------------------------------------------
# Ordering
# ---------------------------------------------------------------------------

def test_orders_by_points_then_gd_then_gf():
    # X,Y equal points; X separated by GD. (no H2H between them needed)
    rows = compute_group_standings(
        ["X", "Y", "Z"],
        [("X", "Z", 2, 0), ("Y", "Z", 1, 0)],
    )
    assert _order(rows) == ["X", "Y", "Z"]
    assert all(not r.tied for r in rows)

    # X,Y equal points AND gd; X separated by GF.
    rows = compute_group_standings(
        ["X", "Y", "Z"],
        [("X", "Z", 2, 1), ("Y", "Z", 1, 0)],
    )
    assert _order(rows) == ["X", "Y", "Z"]
    assert all(not r.tied for r in rows)


def test_head_to_head_breaks_a_two_way_overall_tie():
    # A clear 1st; B,C,D all on 3 pts. D below on GD. B & C identical on
    # (pts, gd, gf) -> separated only by H2H (B beat C 2-0).
    rows = compute_group_standings(
        ["A", "B", "C", "D"],
        [
            ("A", "B", 1, 0),
            ("A", "C", 1, 0),
            ("A", "D", 1, 0),
            ("B", "C", 2, 0),
            ("B", "D", 1, 2),   # D beats B
            ("C", "D", 3, 0),
        ],
    )
    d = _by_id(rows)
    assert _order(rows) == ["A", "B", "C", "D"]
    assert [r.rank for r in rows] == [1, 2, 3, 4]
    # B & C were level on overall but H2H separated them -> NOT tied
    assert d["B"].tied is False and d["C"].tied is False
    assert (d["B"].pts, d["B"].gd, d["B"].gf) == (3, 0, 3)
    assert (d["C"].pts, d["C"].gd, d["C"].gf) == (3, 0, 3)
    assert d["A"].pts == 9 and d["D"].gd == -3


# ---------------------------------------------------------------------------
# Honest "tied" fallback
# ---------------------------------------------------------------------------

def test_full_h2h_cycle_falls_back_deterministically():
    # A>B>C>A, all 1-0; each also beats D 2-0. A,B,C identical on overall AND
    # on H2H -> unresolvable. Must NOT loop/throw; deterministic alpha order, all tied.
    rows = compute_group_standings(
        ["C", "A", "B", "D"],   # deliberately unsorted input
        [
            ("A", "B", 1, 0),
            ("B", "C", 1, 0),
            ("C", "A", 1, 0),
            ("A", "D", 2, 0),
            ("B", "D", 2, 0),
            ("C", "D", 2, 0),
        ],
    )
    d = _by_id(rows)
    assert _order(rows) == ["A", "B", "C", "D"]
    assert d["A"].tied and d["B"].tied and d["C"].tied
    assert d["D"].tied is False
    assert [r.rank for r in rows] == [1, 2, 3, 4]
    # all three level on the table
    for tid in ("A", "B", "C"):
        assert (d[tid].pts, d[tid].gd, d[tid].gf) == (6, 2, 3)


def test_pre_tournament_all_zero_all_tied():
    rows = compute_group_standings(["D", "B", "C", "A"], [])
    assert _order(rows) == ["A", "B", "C", "D"]   # deterministic alpha
    assert all(r.played == 0 and r.pts == 0 for r in rows)
    assert all(r.tied for r in rows)
    assert [r.rank for r in rows] == [1, 2, 3, 4]
