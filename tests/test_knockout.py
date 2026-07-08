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
from engine.knockout import (
    ANNEX_C,
    KnockoutMatchState,
    advance_prob,
    assert_real_bracket_consistent,
    play_bracket,
    resolve_r32,
    resolve_real_winners,
)

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
    champion, reached, played = play_bracket(r32, elo, np.random.default_rng(7))
    assert champion in elo
    assert len(reached) == 32                              # all R32 teams played
    # champion must have advanced through every round it played
    assert {"r32", "r16", "qf", "sf", "final"} <= reached[champion]
    # P17: played covers all 32 knockout matches, R32 in template orientation
    assert set(played) == set(KO_MATCHES)
    assert all(played[no] == r32[no] for no in r32)


def test_play_bracket_is_deterministic_with_seed():
    r32, elo = _full_bracket()
    c1, _, _ = play_bracket(r32, elo, np.random.default_rng(42))
    c2, _, _ = play_bracket(r32, elo, np.random.default_rng(42))
    assert c1 == c2


# --- P17: real-result locking -------------------------------------------------


def _state(no, home, away, settled=True, hg=None, ag=None, winner=None):
    return KnockoutMatchState(
        match_no=no, home_team=home, away_team=away,
        is_settled=settled, home_goals=hg, away_goals=ag, winner=winner,
    )


def test_resolve_real_winners_from_goals_and_winner_column():
    states = {
        73: _state(73, "RA", "RB", hg=2, ag=0),                    # decisive goals
        74: _state(74, "WE", "TA", hg=1, ag=1, winner="away"),     # PK, fd winner
        75: _state(75, "WF", "RC", settled=False),                 # unplayed -> absent
        76: _state(76, "WC", "RF", hg=3, ag=3, winner=None),       # PK, winner unknown -> absent
    }
    resolved = resolve_real_winners(states)
    assert resolved == {73: "RA", 74: "TA"}


def test_resolve_real_winners_downstream_inference_orientation_insensitive():
    # m89 = winner m74 vs winner m77; fd lists them in the OPPOSITE order to the template.
    states = {
        74: _state(74, "WE", "TA", hg=1, ag=1),                    # PK, no winner column
        77: _state(77, "WI", "TC", hg=0, ag=0),
        89: _state(89, "TC", "TA", settled=False),                 # next round pins both
    }
    resolved = resolve_real_winners(states)
    assert resolved == {74: "TA", 77: "TC"}


def test_resolve_real_winners_match_loser_inference():
    # m103 (3rd place) participants are the SF LOSERS -> implies the SF winners.
    states = {
        101: _state(101, "A", "B", hg=1, ag=1),
        102: _state(102, "C", "D", hg=2, ag=2),
        103: _state(103, "B", "D", settled=False),
    }
    resolved = resolve_real_winners(states)
    assert resolved == {101: "A", 102: "C"}


def test_resolve_real_winners_contradiction_raises():
    # goals say WE won m74, but the next round contains TA -> fail loud.
    states = {
        74: _state(74, "WE", "TA", hg=2, ag=0),
        77: _state(77, "WI", "TC", hg=1, ag=0),
        89: _state(89, "TA", "WI", settled=False),
    }
    with pytest.raises(ValueError, match="contradicts"):
        resolve_real_winners(states)


def test_resolve_real_winners_unrelated_participant_raises():
    states = {
        77: _state(77, "WI", "TC", hg=1, ag=0),
        89: _state(89, "XX", "YY", settled=False),                 # neither played m77
    }
    with pytest.raises(ValueError, match="expected exactly 1"):
        resolve_real_winners(states)


def test_assert_real_bracket_consistent_detects_wrong_pairing():
    states = {
        74: _state(74, "WE", "TA", hg=2, ag=0),                    # WE won
        77: _state(77, "WI", "TC", hg=1, ag=0),                    # WI won
        89: _state(89, "WE", "WI", settled=False),                 # consistent
    }
    resolved = resolve_real_winners(states)
    assert_real_bracket_consistent(states, resolved)               # no raise

    bad = dict(states)
    bad[89] = _state(89, "WE", "TC", settled=False)                # TC lost m77
    with pytest.raises(ValueError):
        resolve_real_winners(bad)                                  # caught at inference


def test_play_bracket_fixed_winners_lock_the_whole_tree():
    r32, elo = _full_bracket()
    # Fabricate a fully-settled bracket: home side wins every match. resolve the
    # expected participants by walking the template.
    fixed: dict[int, str] = {}
    winners: dict[int, str] = {}
    losers: dict[int, str] = {}
    for no in sorted(KO_MATCHES):
        m = KO_MATCHES[no]
        if m["stage"] == "r32":
            home, away = r32[no]
        else:
            hs, as_ = m["home"], m["away"]
            home = winners[hs["feeder"]] if hs["type"] == "match_winner" else losers[hs["feeder"]]
            away = winners[as_["feeder"]] if as_["type"] == "match_winner" else losers[as_["feeder"]]
        winners[no], losers[no] = home, away               # home always wins
        fixed[no] = home
    c1, _, played1 = play_bracket(r32, elo, np.random.default_rng(1), fixed_winners=fixed)
    c2, _, played2 = play_bracket(r32, elo, np.random.default_rng(999), fixed_winners=fixed)
    assert c1 == c2 == winners[104]                        # rng-independent
    assert played1 == played2


def test_play_bracket_fixed_winner_not_a_participant_raises():
    r32, elo = _full_bracket()
    with pytest.raises(ValueError, match="not a participant"):
        play_bracket(r32, elo, np.random.default_rng(1), fixed_winners={73: "NOPE"})


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


# --- P17: real-bracket mode (settled-knockout locking + full-tree occupancy) --


def test_simulate_tournament_real_bracket_locks_and_full_tree_occupancy():
    matches, elos = _twelve_groups()
    winners = {g: f"{g}0" for g in GROUPS}
    runners = {g: f"{g}1" for g in GROUPS}
    thirds = {g: f"{g}2" for g in "ABCDEFGH"}
    r32 = resolve_r32(winners, runners, thirds)

    ko_states = {no: _state(no, h, a, settled=False) for no, (h, a) in r32.items()}
    h73, a73 = r32[73]
    h74, a74 = r32[74]
    h75, a75 = r32[75]
    ko_states[73] = _state(73, h73, a73, hg=2, ag=0)                 # decisive
    ko_states[74] = _state(74, h74, a74, hg=1, ag=1, winner="away")  # PK, fd winner
    ko_states[75] = _state(75, h75, a75, hg=0, ag=0)                 # PK, winner pending

    teams, slots = simulate_tournament(
        matches, elos, SimConfig(n=100, seed=5), ko_states=ko_states
    )
    by_id = {t.team_id: t for t in teams}

    # locked results are exact — winners reach R16 with prob 1, losers 0
    assert by_id[h73].p_make_r16 == 1.0 and by_id[a73].p_make_r16 == 0.0
    assert by_id[a74].p_make_r16 == 1.0 and by_id[h74].p_make_r16 == 0.0
    # the pending shootout is sampled (documented transient) — the two split the slot
    assert 0.0 < by_id[h75].p_make_r16 < 1.0
    assert by_id[h75].p_make_r16 + by_id[a75].p_make_r16 == pytest.approx(1.0, abs=1e-9)

    # teams eliminated in the group stage carry exact zeros
    r32_teams = {t for pair in r32.values() for t in pair}
    for tid in set(elos) - r32_teams:
        assert by_id[tid].p_champion == 0.0 and by_id[tid].p_make_r16 == 0.0

    # conservation still exact
    assert sum(t.p_champion for t in teams) == pytest.approx(1.0, abs=1e-9)
    assert sum(t.p_make_final for t in teams) == pytest.approx(2.0, abs=1e-9)

    # occupancy covers the WHOLE tree (32 matches × 2 sides), each side summing to 1
    by_slot: dict[tuple[int, str], float] = defaultdict(float)
    for so in slots:
        by_slot[(so.match_no, so.side)] += so.prob
    assert len(by_slot) == 64
    for total in by_slot.values():
        assert total == pytest.approx(1.0, abs=1e-9)

    # R32 slots are the real teams at prob 1.0 (template orientation)
    top = {(so.match_no, so.side): (so.team_id, so.prob) for so in slots if so.match_no <= 88}
    assert top[(73, "home")] == (h73, 1.0)
    assert top[(74, "away")] == (a74, 1.0)


def test_simulate_tournament_partial_r32_falls_back_to_pre_draw_path():
    matches, elos = _twelve_groups()
    # only one real R32 row -> not a complete real bracket -> Annex C path, R32-only slots
    ko_states = {73: _state(73, "A1", "B1", settled=False)}
    teams, slots = simulate_tournament(
        matches, elos, SimConfig(n=50, seed=3), ko_states=ko_states
    )
    assert len(teams) == 48
    assert {so.match_no for so in slots} <= set(range(73, 89))
