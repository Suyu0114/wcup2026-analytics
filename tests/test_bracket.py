"""Canonical knockout-bracket structural invariants (P13) — pure, offline.

These assert the 2026 R32→Final template (engine/bracket.py) is internally
consistent. They CANNOT prove correctness against FIFA (that needs cross-source
verification of the third-place candidate sets / Annex C), but they catch any
transcription slip and lock the structure the web parity file is generated from.
"""
from __future__ import annotations

import json
import os
from collections import Counter

from engine.bracket import (
    GROUPS,
    KO_MATCHES,
    STAGE_RANGES,
    THIRD_PLACE_SLOTS,
    bracket_data,
)


def _r32_slots() -> list[dict]:
    slots: list[dict] = []
    for no in range(73, 89):
        slots.append(KO_MATCHES[no]["home"])
        slots.append(KO_MATCHES[no]["away"])
    return slots


# --- Coverage / shape ------------------------------------------------------

def test_thirtytwo_matches_73_to_104():
    assert len(KO_MATCHES) == 32
    assert sorted(KO_MATCHES) == list(range(73, 105))


def test_stage_counts():
    counts = Counter(m["stage"] for m in KO_MATCHES.values())
    assert counts == {"r32": 16, "r16": 8, "qf": 4, "sf": 2, "3rd": 1, "final": 1}


def test_stage_ranges_partition_73_to_104():
    covered: list[int] = []
    for lo, hi in STAGE_RANGES.values():
        covered.extend(range(lo, hi + 1))
    assert sorted(covered) == list(range(73, 105))  # contiguous, no gaps/overlaps


# --- R32 group-slot invariants --------------------------------------------

def test_each_group_winner_and_runnerup_once():
    slots = _r32_slots()
    winners = sorted(s["group"] for s in slots if s["type"] == "winner")
    runners = sorted(s["group"] for s in slots if s["type"] == "runner_up")
    assert winners == list(GROUPS)   # all 12, each exactly once
    assert runners == list(GROUPS)


def test_eight_third_slots_five_candidates_cover_all_groups():
    thirds = [s for s in _r32_slots() if s["type"] == "third"]
    assert len(thirds) == 8
    assert all(len(t["candidates"]) == 5 for t in thirds)
    appearances = [g for t in thirds for g in t["candidates"]]
    assert len(appearances) == 40                       # 8 slots × 5
    assert set(appearances) == set(GROUPS)              # every group reachable


def test_third_place_slots_index():
    assert len(THIRD_PLACE_SLOTS) == 8
    assert set(THIRD_PLACE_SLOTS) == {74, 77, 79, 80, 81, 82, 85, 87}
    assert all(len(c) == 5 for c in THIRD_PLACE_SLOTS.values())


# --- Feeder tree invariants -----------------------------------------------

def test_tree_consumes_every_feeder_exactly_once():
    winner_feeders: list[int] = []
    loser_feeders: list[int] = []
    for no in range(89, 105):
        for slot in (KO_MATCHES[no]["home"], KO_MATCHES[no]["away"]):
            if slot["type"] == "match_winner":
                winner_feeders.append(slot["feeder"])
            elif slot["type"] == "match_loser":
                loser_feeders.append(slot["feeder"])

    wc = Counter(winner_feeders)
    # 73–100 each feed exactly one later match as a winner; 101 & 102 feed the
    # final as winners (and the third-place play-off as losers).
    for n in range(73, 101):
        assert wc[n] == 1, f"match {n} winner-feeder count {wc[n]} != 1"
    assert wc[101] == 1 and wc[102] == 1
    assert sum(wc.values()) == 30
    assert sorted(loser_feeders) == [101, 102]


def test_feeders_reference_earlier_matches():
    for no, m in KO_MATCHES.items():
        for slot in (m["home"], m["away"]):
            if "feeder" in slot:
                assert slot["feeder"] < no, f"match {no} feeds from later {slot['feeder']}"


# --- Generator payload -----------------------------------------------------

def test_bracket_data_json_serializable_and_complete():
    data = bracket_data()
    payload = json.loads(json.dumps(data))  # must round-trip cleanly
    assert payload["groups"] == list(GROUPS)
    assert {int(k) for k in payload["matches"]} == set(range(73, 105))
    # every match carries stage + both slots
    for m in payload["matches"].values():
        assert m["stage"] in STAGE_RANGES
        assert "home" in m and "away" in m


# --- Web parity (single source of truth) -----------------------------------

def test_web_bracket_data_matches_engine():
    """web/lib/bracket.data.json must equal the engine canonical. If this fails,
    regenerate it: ``python web/tests/fixtures/gen_bracket.py`` (PYTHONPATH=repo
    root). Guards the single source of truth (CLAUDE.md trap #13c)."""
    repo_root = os.path.dirname(os.path.dirname(__file__))  # tests/ -> repo root
    path = os.path.join(repo_root, "web", "lib", "bracket.data.json")
    with open(path, encoding="utf-8") as fh:
        on_disk = json.load(fh)
    assert on_disk == json.loads(json.dumps(bracket_data())), (
        "web/lib/bracket.data.json is stale — re-run web/tests/fixtures/gen_bracket.py"
    )
