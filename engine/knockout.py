"""Knockout-stage simulation primitives (P14): faithful Annex C allocation + single-
elimination play. Pure functions over engine.bracket + Dixon–Coles win expectancy.

Knockout ties are no-draw: 'advance' uses the win expectancy We = p_home + ½·p_draw —
the regulation-time draw mass splits to extra time / penalties (trap #6). We do NOT
model the shootout separately (documented modelling choice).

Host advantage: v1 treats every knockout game as NEUTRAL (no HFA). The three hosts'
edge in their own venues is a documented follow-up needing the slot→venue→country
curation (same gate as P13 venues); advance_prob already takes host flags so it drops
in without an API change.

The Monte Carlo driver is group_sim.simulate_tournament (reuses the group-resolution
helpers). Annex C is the scraped+validated FIFA table (engine/data/annex_c.json,
gen_annex_c.py); load fails loud if it is absent (no silent approximation).
"""
from __future__ import annotations

import json
import os
from functools import lru_cache

from engine.bracket import KO_MATCHES, THIRD_PLACE_SLOTS
from engine.dixon_coles import derive, elo_to_lambdas, score_matrix

_ANNEX_PATH = os.path.join(os.path.dirname(__file__), "data", "annex_c.json")


def load_annex_c(path: str = _ANNEX_PATH) -> dict[str, dict[str, str]]:
    """Load the faithful Annex C table. Fail loud if missing (no approximation)."""
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"Annex C table missing at {path}; run `python engine/data/gen_annex_c.py` (P14)."
        )
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


ANNEX_C: dict[str, dict[str, str]] = load_annex_c()

# R32 match numbers (ascending) and all knockout matches ascending. Feeders always
# precede their consumer (tests/test_bracket.py guarantees), so a single ascending
# pass resolves the whole tree.
_R32_NOS: list[int] = sorted(n for n, m in KO_MATCHES.items() if m["stage"] == "r32")
_ALL_NOS: list[int] = sorted(KO_MATCHES)


# ---------------------------------------------------------------------------
# Win expectancy (no-draw advance probability)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=None)
def _we(elo_home: float, elo_away: float, is_host_home: bool, is_host_away: bool) -> float:
    lh, la = elo_to_lambdas(elo_home, elo_away, is_host_home, is_host_away)
    p_home, p_draw, _p_away, _o, _b = derive(score_matrix(lh, la))
    return p_home + 0.5 * p_draw


def advance_prob(
    elo_home: float, elo_away: float, is_host_home: bool = False, is_host_away: bool = False
) -> float:
    """P(home advances) = We = p_home + ½·p_draw (trap #6). Memoised by (elo, host)."""
    return _we(float(elo_home), float(elo_away), bool(is_host_home), bool(is_host_away))


# ---------------------------------------------------------------------------
# Round of 32 construction (Annex C)
# ---------------------------------------------------------------------------

def annex_key(qual_third_groups) -> str:
    """The 8 qualifying-third group letters, sorted, e.g. {'E','A',...} -> 'ABEFGHIJ'."""
    return "".join(sorted(qual_third_groups))


def resolve_r32(
    winners: dict[str, str],
    runners_up: dict[str, str],
    thirds_by_group: dict[str, str],
) -> dict[int, tuple[str, str]]:
    """One simulation's group outcomes -> the 16 R32 (home_team, away_team) pairs.

    winners / runners_up: {group -> team_id} (12 each). thirds_by_group: {group -> team_id}
    for the 8 qualifying third groups. Third-place slots are resolved via faithful Annex C:
    in a winner-vs-third match the home winner's group keys the slot ("1<group>").
    """
    assign = ANNEX_C[annex_key(thirds_by_group.keys())]  # {"1X": "3Y"}; KeyError = bad input (fail loud)

    r32: dict[int, tuple[str, str]] = {}
    for no in _R32_NOS:
        home_slot, away_slot = KO_MATCHES[no]["home"], KO_MATCHES[no]["away"]
        if away_slot["type"] == "third":
            wgroup = home_slot["group"]                 # home is the group winner
            third_group = assign[f"1{wgroup}"][1]       # "3Y" -> "Y"
            r32[no] = (winners[wgroup], thirds_by_group[third_group])
        else:
            r32[no] = (_resolve_fixed(home_slot, winners, runners_up),
                       _resolve_fixed(away_slot, winners, runners_up))
    return r32


def _resolve_fixed(slot: dict, winners: dict[str, str], runners_up: dict[str, str]) -> str:
    if slot["type"] == "winner":
        return winners[slot["group"]]
    if slot["type"] == "runner_up":
        return runners_up[slot["group"]]
    raise AssertionError(f"unexpected non-third R32 slot {slot}")


# ---------------------------------------------------------------------------
# Single-elimination play
# ---------------------------------------------------------------------------

def _feeder_team(slot: dict, result: dict[int, tuple[str, str]]) -> str:
    winner, loser = result[slot["feeder"]]
    return winner if slot["type"] == "match_winner" else loser


def play_bracket(
    r32: dict[int, tuple[str, str]],
    elo: dict[str, float],
    rng,
) -> tuple[str, dict[str, set[str]]]:
    """Play one bracket to a champion. Returns (champion_team_id, reached) where
    reached maps team_id -> the set of stages it played in ('r32'..'final', plus '3rd'
    for the two semi-final losers). rng is an np.random.Generator (rng.random())."""
    result: dict[int, tuple[str, str]] = {}   # match_no -> (winner, loser)
    reached: dict[str, set[str]] = {}

    for no in _ALL_NOS:
        m = KO_MATCHES[no]
        if m["stage"] == "r32":
            home, away = r32[no]
        else:
            home = _feeder_team(m["home"], result)
            away = _feeder_team(m["away"], result)
        reached.setdefault(home, set()).add(m["stage"])
        reached.setdefault(away, set()).add(m["stage"])
        if rng.random() < advance_prob(elo[home], elo[away]):
            result[no] = (home, away)
        else:
            result[no] = (away, home)

    champion = result[104][0]  # winner of the Final (match 104)
    return champion, reached
