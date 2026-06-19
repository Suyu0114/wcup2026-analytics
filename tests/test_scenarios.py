"""Qualification scenario-analysis tests (P11) — pure, offline, deterministic.

Covers the points-band classification (top2/eliminated/alive + facets), the
seeding_live & dead_rubber match-level flags ([A]), the convenience_draw strong
definition and its intentional GD-only false-negative ([B]), parallel-match and
multi-pending enumeration (MD3/MD2), the four-way tie, a full H2H cycle, the
final-match invariant, determinism, and fail-loud. No DB, no Elo, no randomness.
"""
from __future__ import annotations

import pytest

from engine.scenarios import (
    STATUS_TOP2,
    STATUS_ELIMINATED,
    STATUS_ALIVE,
    ScenarioMatch,
    analyze_group,
)

G = "A"  # group label for fixtures


def _m(mid: str, home: str, away: str, hg: int | None = None, ag: int | None = None) -> ScenarioMatch:
    status = "final" if hg is not None else "scheduled"
    return ScenarioMatch(mid, G, home, away, status, hg, ag)


def _scn(scenarios, mid):
    return next(s for s in scenarios if s.match_id == mid)


def _home(s, outcome):
    return s.outcomes[outcome][0]


def _away(s, outcome):
    return s.outcomes[outcome][1]


# ---------------------------------------------------------------------------
# Fixtures (hand-verified in P11-spec §10)
# ---------------------------------------------------------------------------

def _fixture_md3():
    """MD1/MD2 final → base A6 B3 C3 D0; pending AD, BC (spec SC3/4/5/7/11/12)."""
    return [
        _m("AB", "A", "B", 1, 0),
        _m("AC", "A", "C", 1, 0),
        _m("BD", "B", "D", 1, 0),
        _m("CD", "C", "D", 1, 0),
        _m("AD", "A", "D"),
        _m("BC", "B", "C"),
    ]


def _fixture_dead_rubber():
    """base A6 B4 C4 D0; pending AD where A pinned 1st, D pinned 4th (spec SC6)."""
    return [
        _m("AB", "A", "B", 1, 0),
        _m("AC", "A", "C", 1, 0),
        _m("BC", "B", "C", 1, 1),
        _m("BD", "B", "D", 1, 0),
        _m("CD", "C", "D", 1, 0),
        _m("AD", "A", "D"),
    ]


def _fixture_seeding():
    """base A6 B6 C3 D0; pending AB decides 1st vs 2nd (spec SC2/SC15)."""
    return [
        _m("AC", "A", "C", 1, 0),
        _m("AD", "A", "D", 1, 0),
        _m("BC", "B", "C", 1, 0),
        _m("BD", "B", "D", 1, 0),
        _m("CD", "C", "D", 1, 0),
        _m("AB", "A", "B"),
    ]


def _fixture_gd_only():
    """base A4 B4 C5 D0; pending AB. A draw → A5 B5 C5 (3-way points tie) (spec SC1/SC14)."""
    return [
        _m("AC", "A", "C", 1, 1),
        _m("AD", "A", "D", 1, 0),
        _m("BC", "B", "C", 1, 1),
        _m("BD", "B", "D", 1, 0),
        _m("CD", "C", "D", 1, 0),
        _m("AB", "A", "B"),
    ]


def _fixture_md2():
    """MD1 final (AB, CD); MD2 (AC, BD) + MD3 (AD, BC) pending → 4 pending (spec SC8)."""
    return [
        _m("AB", "A", "B", 2, 0),
        _m("CD", "C", "D", 1, 0),
        _m("AC", "A", "C"),
        _m("BD", "B", "D"),
        _m("AD", "A", "D"),
        _m("BC", "B", "C"),
    ]


def _fixture_fresh():
    """All six matches pending (spec SC9 — four-way tie reachable)."""
    return [
        _m("AB", "A", "B"), _m("AC", "A", "C"), _m("AD", "A", "D"),
        _m("BC", "B", "C"), _m("BD", "B", "D"), _m("CD", "C", "D"),
    ]


# ---------------------------------------------------------------------------
# SC1 — never-false-clinch (GD-only clinch reported as alive)
# ---------------------------------------------------------------------------

def test_sc1_gd_only_clinch_reported_alive():
    s = _scn(analyze_group(G, _fixture_gd_only()), "AB")
    a = _home(s, "draw")  # A under a draw → A5, B5, C5 (3-way points tie)
    assert a.status == STATUS_ALIVE          # conservative: GD might clinch, we don't claim it
    assert a.status != STATUS_TOP2


# ---------------------------------------------------------------------------
# SC2 — strong convenience draw
# ---------------------------------------------------------------------------

def test_sc2_convenience_draw_top2():
    s = _scn(analyze_group(G, _fixture_seeding()), "AB")
    assert s.convenience_draw is True
    assert s.convenience_draw_kind == "top2"
    assert _home(s, "draw").status == STATUS_TOP2
    assert _away(s, "draw").status == STATUS_TOP2


# ---------------------------------------------------------------------------
# SC3 — top-2 clinch on points alone (GD irrelevant)
# ---------------------------------------------------------------------------

def test_sc3_top2_clinch_pure_points():
    s = _scn(analyze_group(G, _fixture_md3()), "AD")
    a_draw = _home(s, "draw")     # A draws D → A7, unreachable by others
    assert a_draw.status == STATUS_TOP2
    # A clinches top-2 under every outcome of its own match (even losing)
    assert _home(s, "home").status == STATUS_TOP2
    assert _home(s, "away").status == STATUS_TOP2


# ---------------------------------------------------------------------------
# SC4 — eliminated
# ---------------------------------------------------------------------------

def test_sc4_eliminated_on_loss():
    s = _scn(analyze_group(G, _fixture_md3()), "AD")
    d_loss = _away(s, "home")     # AD home = A win = D loses → D 0, always 4th
    assert d_loss.status == STATUS_ELIMINATED
    assert d_loss.basis_key == "eliminated"


# ---------------------------------------------------------------------------
# SC5 — secured at least 3rd but advancement hinges on best-third (no false clinch)
# ---------------------------------------------------------------------------

def test_sc5_needs_best_third_not_clinched():
    s = _scn(analyze_group(G, _fixture_md3()), "BC")
    b_draw = _home(s, "draw")     # B draws C → B4, band [2,3] across parallel AD
    assert b_draw.status == STATUS_ALIVE
    assert b_draw.secured_3rd_or_better is True
    assert b_draw.needs_best_third is True
    assert b_draw.basis_key == "secured_third_needs_race"


# ---------------------------------------------------------------------------
# SC6 — dead rubber (both pinned, no seeding scope)
# ---------------------------------------------------------------------------

def test_sc6_dead_rubber():
    s = _scn(analyze_group(G, _fixture_dead_rubber()), "AD")
    assert s.dead_rubber is True
    for o in ("home", "draw", "away"):
        assert _home(s, o).status == STATUS_TOP2 and _home(s, o).seeding_live is False
        assert _away(s, o).status == STATUS_ELIMINATED
    assert s.convenience_draw is False


# ---------------------------------------------------------------------------
# SC7 — MD3 parallel-match dependency
# ---------------------------------------------------------------------------

def test_sc7_parallel_dependency_drives_seeding():
    s = _scn(analyze_group(G, _fixture_md3()), "AD")
    a_loss = _home(s, "away")     # A loses to D → A6; 1st vs 2nd hinges on parallel BC
    assert a_loss.status == STATUS_TOP2
    assert a_loss.seeding_live is True


# ---------------------------------------------------------------------------
# SC8 — MD2 (4 pending, 3^3 enumeration) — structure + determinism
# ---------------------------------------------------------------------------

def test_sc8_md2_enumeration():
    scenarios = analyze_group(G, _fixture_md2())
    pending_ids = {"AC", "BD", "AD", "BC"}
    assert {s.match_id for s in scenarios} == pending_ids
    for s in scenarios:
        assert set(s.outcomes.keys()) == {"home", "draw", "away"}
    # deterministic
    again = analyze_group(G, _fixture_md2())
    assert [s.dead_rubber for s in scenarios] == [s.dead_rubber for s in again]


# ---------------------------------------------------------------------------
# SC9 — four-way tie reachable (1994 Group E) → everyone alive, honest
# ---------------------------------------------------------------------------

def test_sc9_four_way_tie_all_alive():
    s = _scn(analyze_group(G, _fixture_fresh()), "AB")
    a = _home(s, "home")          # A wins opener; can still be 1st or 4th
    assert a.status == STATUS_ALIVE
    assert a.can_win_group is True
    assert a.secured_3rd_or_better is False   # could finish 4th
    assert s.dead_rubber is False


# ---------------------------------------------------------------------------
# SC10 — full H2H cycle among finals: no crash, deterministic
# ---------------------------------------------------------------------------

def test_sc10_h2h_cycle_no_crash():
    # A>B>C>A among finals (points-band ignores H2H, so this can never recurse).
    matches = [
        _m("AB", "A", "B", 1, 0),
        _m("BC", "B", "C", 1, 0),
        _m("AC", "A", "C", 0, 1),   # C beats A
        _m("AD", "A", "D", 1, 0),
        _m("BD", "B", "D", 1, 0),
        _m("CD", "C", "D"),         # pending
    ]
    first = analyze_group(G, matches)
    second = analyze_group(G, matches)
    assert len(first) == 1 and first[0].match_id == "CD"
    assert [_home(s, "draw").status for s in first] == [_home(s, "draw").status for s in second]


# ---------------------------------------------------------------------------
# SC11 — mixed final/pending: only pending matches get scenarios
# ---------------------------------------------------------------------------

def test_sc11_only_pending_matches_analyzed():
    scenarios = analyze_group(G, _fixture_md3())
    assert {s.match_id for s in scenarios} == {"AD", "BC"}


# ---------------------------------------------------------------------------
# SC12 — determinism + final-match invariant
# ---------------------------------------------------------------------------

def test_sc12_determinism_and_no_final_rows():
    matches = _fixture_md3()
    final_ids = {m.match_id for m in matches if m.is_final}
    runs = [analyze_group(G, matches) for _ in range(2)]
    assert [s.match_id for s in runs[0]] == [s.match_id for s in runs[1]]
    for s in runs[0]:
        assert s.match_id not in final_ids   # table never holds a final match (spec §8.2)


# ---------------------------------------------------------------------------
# SC13 — fail-loud
# ---------------------------------------------------------------------------

def test_sc13_fail_loud_group_size():
    with pytest.raises(ValueError):
        analyze_group(G, [_m("AB", "A", "B"), _m("AC", "A", "C")])  # only 3 teams


def test_sc13_fail_loud_final_missing_goals():
    bad = ScenarioMatch("AD", G, "A", "D", "final", None, None)
    with pytest.raises(ValueError):
        analyze_group(G, _fixture_md3()[:5] + [bad] + [_m("BC", "B", "C")])


# ---------------------------------------------------------------------------
# SC14 — GD-only convenience draw → intentionally NOT flagged ([B])
# ---------------------------------------------------------------------------

def test_sc14_gd_only_convenience_draw_false_negative():
    s = _scn(analyze_group(G, _fixture_gd_only()), "AB")
    assert s.convenience_draw is False                          # false-negative-by-design
    assert s.convenience_draw_kind == "mutual_3rd_conditional"  # weaker conditional signal
    assert _home(s, "draw").secured_3rd_or_better is True
    assert _away(s, "draw").secured_3rd_or_better is True


# ---------------------------------------------------------------------------
# SC15 — seeding_live: both clinched top-2 but order undecided ([A])
# ---------------------------------------------------------------------------

def test_sc15_seeding_live_not_dead_rubber():
    s = _scn(analyze_group(G, _fixture_seeding()), "AB")
    assert _home(s, "draw").status == STATUS_TOP2
    assert _away(s, "draw").status == STATUS_TOP2
    assert _home(s, "draw").seeding_live is True
    assert _away(s, "draw").seeding_live is True
    assert s.dead_rubber is False
