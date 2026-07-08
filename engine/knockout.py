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
from dataclasses import dataclass
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
# Real-bracket state (P17): settled-knockout locking inputs
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class KnockoutMatchState:
    """One real knockout match as stored in `matches` (P17 locking input).

    winner is fd's score.winner mapped to 'home'/'away' — the only per-row source of
    who advanced when a shootout leaves fullTime level. None = not (yet) known."""
    match_no: int
    home_team: str
    away_team: str
    is_settled: bool
    home_goals: int | None
    away_goals: int | None
    winner: str | None            # 'home' | 'away' | None


def resolve_real_winners(ko_states: dict[int, KnockoutMatchState]) -> dict[int, str]:
    """Deterministic winner team_id per match_no, from every honest source (P17).

    1. fd score.winner (covers penalty shootouts).
    2. Settled decisive goals (fullTime incl. ET).
    3. Downstream inference: a later real match's participants pin its feeders'
       outcomes — a `match_winner` participant IS the feeder's winner; a `match_loser`
       participant (third-place play-off) implies the feeder's winner is the OTHER team.

    A settled shootout that none of these resolve yet is deliberately absent
    (sampled via We until fd supplies the winner or fills the next round — documented
    transient). Contradictions raise (verify-don't-assume; fd transients self-heal on
    the next recompute)."""
    resolved: dict[int, str] = {}

    def _record(no: int, team: str, source: str) -> None:
        prev = resolved.get(no)
        if prev is not None and prev != team:
            raise ValueError(
                f"match {no}: winner {team!r} from {source} contradicts {prev!r} "
                f"(fail-loud, P17)"
            )
        resolved[no] = team

    # Pass 1: per-match evidence.
    for no, st in ko_states.items():
        if not st.is_settled:
            continue
        goals_winner = None
        if st.home_goals is not None and st.away_goals is not None and st.home_goals != st.away_goals:
            goals_winner = st.home_team if st.home_goals > st.away_goals else st.away_team
        col_winner = None
        if st.winner is not None:
            col_winner = st.home_team if st.winner == "home" else st.away_team
        if goals_winner and col_winner and goals_winner != col_winner:
            raise ValueError(
                f"match {no}: fd winner {col_winner!r} contradicts goals "
                f"({st.home_goals},{st.away_goals}) (fail-loud, P17)"
            )
        w = col_winner or goals_winner
        if w:
            _record(no, w, "per-match result")

    # Pass 2: downstream inference. Orientation-insensitive — fd's home/away for a
    # later round need not match the template's slot order (trap #5 spirit).
    for no, m in KO_MATCHES.items():
        consumer = ko_states.get(no)
        if consumer is None or m["stage"] == "r32":
            continue
        participants = {consumer.home_team, consumer.away_team}
        for side in ("home", "away"):
            slot = m[side]
            feeder = ko_states.get(slot["feeder"])
            if feeder is None:
                continue
            feeder_teams = {feeder.home_team, feeder.away_team}
            overlap = participants & feeder_teams
            if len(overlap) != 1:
                raise ValueError(
                    f"match {no} participants {sorted(participants)} match "
                    f"{len(overlap)} teams of feeder m{slot['feeder']} "
                    f"{sorted(feeder_teams)} — expected exactly 1 (fail-loud, P17)"
                )
            participant = overlap.pop()
            if slot["type"] == "match_winner":
                _record(slot["feeder"], participant, f"m{no} participants")
            else:  # match_loser (third-place play-off): participant lost the feeder
                other = (feeder_teams - {participant}).pop()
                _record(slot["feeder"], other, f"m{no} (loser side) participants")

    return resolved


def assert_real_bracket_consistent(
    ko_states: dict[int, KnockoutMatchState], resolved: dict[int, str]
) -> None:
    """Every real later-round match whose feeders are fully resolved must pair exactly
    the expected teams (unordered — fd orientation may differ from the template)."""
    for no, m in KO_MATCHES.items():
        st = ko_states.get(no)
        if st is None or m["stage"] == "r32":
            continue
        expected: set[str] = set()
        determined = True
        for side in ("home", "away"):
            slot = m[side]
            feeder_no = slot["feeder"]
            feeder = ko_states.get(feeder_no)
            if feeder_no not in resolved or feeder is None:
                determined = False
                break
            if slot["type"] == "match_winner":
                expected.add(resolved[feeder_no])
            else:  # match_loser
                expected.add(
                    ({feeder.home_team, feeder.away_team} - {resolved[feeder_no]}).pop()
                )
        if determined and expected != {st.home_team, st.away_team}:
            raise ValueError(
                f"match {no}: real teams {sorted({st.home_team, st.away_team})} != "
                f"feeder-derived {sorted(expected)} — fd transient or curation slip "
                f"(fail-loud, P17; re-run recompute once fd settles)"
            )


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
    fixed_winners: dict[int, str] | None = None,
) -> tuple[str, dict[str, set[str]], dict[int, tuple[str, str]]]:
    """Play one bracket to a champion. Returns (champion_team_id, reached, played):
    reached maps team_id -> the set of stages it played in ('r32'..'final', plus '3rd'
    for the two semi-final losers); played maps match_no -> its (home, away) participants
    in template orientation (P17 — full-tree slot occupancy). fixed_winners locks real
    outcomes (P17): those matches advance deterministically, the rest sample via We.
    rng is an np.random.Generator (rng.random())."""
    fixed = fixed_winners or {}
    result: dict[int, tuple[str, str]] = {}   # match_no -> (winner, loser)
    reached: dict[str, set[str]] = {}
    played: dict[int, tuple[str, str]] = {}

    for no in _ALL_NOS:
        m = KO_MATCHES[no]
        if m["stage"] == "r32":
            home, away = r32[no]
        else:
            home = _feeder_team(m["home"], result)
            away = _feeder_team(m["away"], result)
        played[no] = (home, away)
        reached.setdefault(home, set()).add(m["stage"])
        reached.setdefault(away, set()).add(m["stage"])
        locked = fixed.get(no)
        if locked is not None:
            if locked not in (home, away):
                raise ValueError(
                    f"fixed winner {locked!r} of match {no} is not a participant "
                    f"({home}, {away}) — inconsistent locking input (fail-loud, P17)"
                )
            result[no] = (locked, away if locked == home else home)
        elif rng.random() < advance_prob(elo[home], elo[away]):
            result[no] = (home, away)
        else:
            result[no] = (away, home)

    champion = result[104][0]  # winner of the Final (match 104)
    return champion, reached, played
