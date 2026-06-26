"""Knockout-engine tests (P14) — pure, offline.

Re-validates the loaded Annex C table (so a corrupt engine/data/annex_c.json fails the
suite, not just the scraper) and checks the win-expectancy + bracket primitives.
"""
from __future__ import annotations

import numpy as np
import pytest

from collections import defaultdict

from engine.bracket import GROUPS, KO_MATCHES, THIRD_PLACE_SLOTS
from engine.group_sim import GroupMatch, SimConfig, simulate_tournament
from engine.knockout import ANNEX_C, advance_prob, play_bracket, resolve_r32

GROUP_SET = set(GROUPS)

# winner-slot label "1X" -> that slot's candidate set, from the verified bracket
SLOT_CANDIDATES = {
    f"1{KO_MATCHES[mno]['home']['group']}": cands for mno, cands in THIRD_PLACE_SLOTS.items()
}
EXPECTED_SLOTS = set(SLOT_CANDIDATES)  # {1A,1B,1D,1E,1G,1I,1K,1L}


# --- Annex C integrity (re-validate the committed table) -------------------

def test_annex_c_has_495_well_formed_rows():
    assert len(ANNEX_C) == 495
    for key, assign in ANNEX_C.items():
        quals = list(key)
        assert len(quals) == 8 and len(set(quals)) == 8 and set(quals) <= GROUP_SET
        assert key == "".join(sorted(quals))                 # canonical sorted key
        assert set(assign) == EXPECTED_SLOTS                 # all 8 slots present
        thirds = [v[1] for v in assign.values()]
        assert sorted(thirds) == quals                       # bijection onto qualifiers
        for slot, val in assign.items():
            g = val[1]
            assert val.startswith("3") and g in GROUP_SET
            assert g in SLOT_CANDIDATES[slot]                # respects bracket candidate set
            assert slot != f"1{g}"                           # no same-group pairing


def test_annex_c_keys_unique_and_cover_all_combinations():
    from itertools import combinations
    assert set(ANNEX_C) == {"".join(c) for c in combinations(GROUPS, 8)}


# --- Win expectancy --------------------------------------------------------

def test_advance_prob_neutral_even_and_symmetric():
    assert advance_prob(1600, 1600) == pytest.approx(0.5, abs=1e-9)
    for a, b in [(1900, 1500), (1700, 1650), (1500, 2000)]:
        assert advance_prob(a, b) + advance_prob(b, a) == pytest.approx(1.0, abs=1e-9)


def test_advance_prob_monotonic_in_elo_gap():
    assert advance_prob(2000, 1500) > advance_prob(1700, 1500) > advance_prob(1550, 1500) > 0.5
    assert advance_prob(1500, 2000) < 0.5


# --- R32 construction (Annex C) --------------------------------------------

def _synthetic_groups():
    winners = {g: f"W{g}" for g in GROUPS}
    runners = {g: f"R{g}" for g in GROUPS}
    return winners, runners


def test_resolve_r32_uses_annex_for_thirds_and_fixed_for_rest():
    winners, runners = _synthetic_groups()
    quals = "ABCDEFGH"
    thirds = {g: f"T{g}" for g in quals}
    r32 = resolve_r32(winners, runners, thirds)

    assert len(r32) == 16
    a = ANNEX_C[quals]
    # M74 = Winner E vs 3rd assigned to slot 1E; M85 = Winner B vs 3rd of slot 1B
    assert r32[74] == ("WE", thirds[a["1E"][1]])
    assert r32[85] == ("WB", thirds[a["1B"][1]])
    # fixed (no-third) matches keep winner/runner-up slots
    assert r32[73] == ("RA", "RB")          # runner-up A vs runner-up B
    assert r32[76] == ("WC", "RF")          # winner C vs runner-up F
    # 32 distinct participants (12 winners + 12 runners-up + 8 thirds)
    teams = [t for pair in r32.values() for t in pair]
    assert len(teams) == 32 and len(set(teams)) == 32


# --- Single-elimination play ------------------------------------------------

def _full_bracket():
    winners, runners = _synthetic_groups()
    quals = "ABCDEFGH"
    thirds = {g: f"T{g}" for g in quals}
    r32 = resolve_r32(winners, runners, thirds)
    teams = sorted({t for pair in r32.values() for t in pair})
    elo = {t: 1500 + 10 * i for i, t in enumerate(teams)}  # distinct, deterministic
    return r32, elo


def test_play_bracket_champion_is_a_participant_and_reached_is_consistent():
    r32, elo = _full_bracket()
    champion, reached = play_bracket(r32, elo, np.random.default_rng(7))
    assert champion in elo
    assert len(reached) == 32                              # all R32 teams played
    # champion must have advanced through every round it played
    assert {"r32", "r16", "qf", "sf", "final"} <= reached[champion]


def test_play_bracket_is_deterministic_with_seed():
    r32, elo = _full_bracket()
    c1, _ = play_bracket(r32, elo, np.random.default_rng(42))
    c2, _ = play_bracket(r32, elo, np.random.default_rng(42))
    assert c1 == c2


# --- Full-tournament Monte Carlo (simulate_tournament) ----------------------

def _twelve_groups():
    """12 groups × 4 teams, full round-robin (6 matches/group), distinct Elos."""
    matches: list[GroupMatch] = []
    elos: dict[str, float] = {}
    pairs = [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)]
    for gi, g in enumerate(GROUPS):
        teams = [f"{g}{k}" for k in range(4)]
        for k, t in enumerate(teams):
            elos[t] = 1500.0 + 10 * gi + k
        for i, j in pairs:
            matches.append(GroupMatch(
                match_id=f"{g}-{i}{j}", group_label=g,
                home_team=teams[i], away_team=teams[j],
                lambda_home=1.3, lambda_away=1.2,
                is_settled=False, home_goals=None, away_goals=None,
            ))
    return matches, elos


def test_simulate_tournament_conservation_and_monotonicity():
    matches, elos = _twelve_groups()
    teams, slots = simulate_tournament(matches, elos, SimConfig(n=200, seed=3))

    assert len(teams) == 48
    # exact conservation (hold for any N): one champion, 2 finalists, 4 SF, 8 QF, 16 R16
    assert sum(t.p_champion for t in teams) == pytest.approx(1.0, abs=1e-9)
    assert sum(t.p_make_final for t in teams) == pytest.approx(2.0, abs=1e-9)
    assert sum(t.p_make_sf for t in teams) == pytest.approx(4.0, abs=1e-9)
    assert sum(t.p_make_qf for t in teams) == pytest.approx(8.0, abs=1e-9)
    assert sum(t.p_make_r16 for t in teams) == pytest.approx(16.0, abs=1e-9)

    # per-team round-reach is monotonic
    for t in teams:
        assert t.p_champion <= t.p_make_final <= t.p_make_sf <= t.p_make_qf <= t.p_make_r16

    # every R32 slot position (16 matches × 2 sides) is filled in every sim
    by_slot: dict[tuple[int, str], float] = defaultdict(float)
    for so in slots:
        by_slot[(so.match_no, so.side)] += so.prob
    assert len(by_slot) == 32
    for total in by_slot.values():
        assert total == pytest.approx(1.0, abs=1e-9)
