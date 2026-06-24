"""Canonical 2026 World Cup knockout bracket structure (P13).

SINGLE SOURCE OF TRUTH for the knockout slot template + feeder tree. The web
frontend's bracket data (``web/lib/bracket.data.json``) is GENERATED from this
module and guarded by a parity test, mirroring the ``golden_vectors`` pattern
(CLAUDE.md trap #13c) — never hand-author a second copy.

2026 is the first 48-team edition: 12 groups → Round of 32 = top-2 of each group
(24) + the 8 best third-placed teams. The 8 thirds are slotted into R32 via FIFA
**Annex C**, which depends on WHICH 8 groups produce qualifying thirds (the
495 = C(12,8) combinations live in ``engine/knockout.py``, P14). This module only
encodes the FIXED structure: the R32 slot template (incl. each third-place slot's
5-group candidate set) and the R32→Final feeder tree (matches 73–104).

Provenance: FIFA match schedule (matches 73–104), transcribed 2026-06-22 from the
public bracket. The third-place candidate sets + Annex C MUST be cross-checked
against the official FIFA regulations Annex C before production reliance
(verify-don't-assume). Internal-consistency invariants are asserted in
``tests/test_bracket.py`` (12 winners/runners-up each once, 8 third slots, 40
candidate-appearances, every group covered, tree consumes each feeder once).

Pure data + helpers, no I/O (same style as standings.py / scenarios.py).
"""
from __future__ import annotations

# 12 groups (2026). team_id is unrelated — these are group labels 'A'..'L'.
GROUPS: tuple[str, ...] = tuple("ABCDEFGHIJKL")

# stage key → inclusive FIFA match-number range. Stage keys match matches.stage
# (sources/fixture_source.STAGE_MAP) incl. '3rd' (third-place play-off).
STAGE_RANGES: dict[str, tuple[int, int]] = {
    "r32": (73, 88),
    "r16": (89, 96),
    "qf": (97, 100),
    "sf": (101, 102),
    "3rd": (103, 103),
    "final": (104, 104),
}


# --- Slot constructors -----------------------------------------------------
# JSON-native dicts with a "type" tag, so the same representation serializes
# straight to web/lib/bracket.data.json and is consumed by the P14 engine.

def _win(group: str) -> dict:
    """Group winner slot (e.g. 1A)."""
    return {"type": "winner", "group": group}


def _ru(group: str) -> dict:
    """Group runner-up slot (e.g. 2A)."""
    return {"type": "runner_up", "group": group}


def _third(*candidates: str) -> dict:
    """Best-third slot with its 5-group candidate set (Annex C resolves which)."""
    return {"type": "third", "candidates": sorted(candidates)}


def _wm(match_no: int) -> dict:
    """Winner of an earlier knockout match (feeder)."""
    return {"type": "match_winner", "feeder": match_no}


def _lm(match_no: int) -> dict:
    """Loser of an earlier knockout match (feeder; third-place play-off)."""
    return {"type": "match_loser", "feeder": match_no}


# --- Round of 32 slot template (matches 73–88) -----------------------------
# 8 matches pair fixed group slots (winner/runner-up); 8 matches pair a group
# winner against a best-third candidate set. Home/away orientation here is the
# FIFA schedule's; ingest keeps fd's orientation (trap #5 is_host_away).
_R32: dict[int, tuple[dict, dict]] = {
    73: (_ru("A"), _ru("B")),
    74: (_win("E"), _third("A", "B", "C", "D", "F")),
    75: (_win("F"), _ru("C")),
    76: (_win("C"), _ru("F")),
    77: (_win("I"), _third("C", "D", "F", "G", "H")),
    78: (_ru("E"), _ru("I")),
    79: (_win("A"), _third("C", "E", "F", "H", "I")),
    80: (_win("L"), _third("E", "H", "I", "J", "K")),
    81: (_win("D"), _third("B", "E", "F", "I", "J")),
    82: (_win("G"), _third("A", "E", "H", "I", "J")),
    83: (_ru("K"), _ru("L")),
    84: (_win("H"), _ru("J")),
    85: (_win("B"), _third("E", "F", "G", "I", "J")),
    86: (_win("J"), _ru("H")),
    87: (_win("K"), _third("D", "E", "I", "J", "L")),
    88: (_ru("D"), _ru("G")),
}

# --- Feeder tree (matches 89–104) ------------------------------------------
_TREE: dict[int, tuple[dict, dict]] = {
    # Round of 16
    89: (_wm(74), _wm(77)),
    90: (_wm(73), _wm(75)),
    91: (_wm(76), _wm(78)),
    92: (_wm(79), _wm(80)),
    93: (_wm(83), _wm(84)),
    94: (_wm(81), _wm(82)),
    95: (_wm(86), _wm(88)),
    96: (_wm(85), _wm(87)),
    # Quarter-finals
    97: (_wm(89), _wm(90)),
    98: (_wm(93), _wm(94)),
    99: (_wm(91), _wm(92)),
    100: (_wm(95), _wm(96)),
    # Semi-finals
    101: (_wm(97), _wm(98)),
    102: (_wm(99), _wm(100)),
    # Third-place play-off + Final
    103: (_lm(101), _lm(102)),
    104: (_wm(101), _wm(102)),
}


def _stage_of(match_no: int) -> str:
    for stage, (lo, hi) in STAGE_RANGES.items():
        if lo <= match_no <= hi:
            return stage
    raise ValueError(f"match {match_no} outside known knockout ranges (fail-loud)")


# Unified canonical map: FIFA match_no → {stage, home slot, away slot}.
KO_MATCHES: dict[int, dict] = {
    no: {"match_no": no, "stage": _stage_of(no), "home": home, "away": away}
    for no, (home, away) in {**_R32, **_TREE}.items()
}

# Convenience: the 8 best-third slots → their candidate group sets (Annex C input).
THIRD_PLACE_SLOTS: dict[int, frozenset[str]] = {
    no: frozenset(slot["away"]["candidates"])
    for no, slot in KO_MATCHES.items()
    if slot["away"]["type"] == "third"
}


def bracket_data() -> dict:
    """JSON-serializable canonical structure for the web generator (single source
    of truth → web/lib/bracket.data.json; see tests/test_bracket.py parity test)."""
    return {
        "groups": list(GROUPS),
        "stage_ranges": {k: list(v) for k, v in STAGE_RANGES.items()},
        "matches": {str(no): m for no, m in sorted(KO_MATCHES.items())},
    }
