"""Group-stage qualification scenario analysis (P11).

Pure functions, no I/O — offline-testable (same style as group_sim.py / standings.py).

For every not-yet-final group match, answer: what does each of W / D / L do to the
two teams' qualification status? Plus the match-level ``convenience_draw`` and
``dead_rubber`` flags.

This is a deterministic FACT (no model, no Elo, no randomness — cf. P8 standings).
The qualification math is **points-band** reasoning (spec §5.2): for a given W/D/L
completion of the group's other pending matches, teams level on POINTS form a band
whose internal order (GD/GF/H2H/lots) is treated as undetermined → every rank in the
band is possible. This is a sound over-approximation (spec §5.3): it never falsely
claims a clinch/elimination — it can only under-claim ("alive" where GD would in
reality decide). The GD-only false-negative for convenience_draw is intentional
(spec §3.3 [B]).

Cross-group best-third safety is NOT decided here (v1-lean, spec §6): a team that
secured at least 3rd within its group but could finish 3rd stays ``alive`` with
``needs_best_third=True``. Probabilities (the model overlay) live in the frontend,
strictly separated (spec §7).
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass

# Status values (spec §4). ``advance_clinched`` is reserved for the §6.2 follow-up
# (deterministic best-third clinch when all other groups are final); v1 never emits it.
STATUS_TOP2 = "top2_clinched"
STATUS_ADVANCE = "advance_clinched"
STATUS_ELIMINATED = "eliminated"
STATUS_ALIVE = "alive"

OUTCOMES = ("home", "draw", "away")

KIND_TOP2 = "top2"
KIND_MUTUAL_3RD = "mutual_3rd_conditional"


@dataclass
class ScenarioMatch:
    """One group-stage match: final (with score) or pending."""
    match_id: str
    group_label: str          # 'A'..'L'
    home_team: str            # team_id (two-letter, trap #1)
    away_team: str
    status: str               # 'final' | anything else
    home_goals: int | None    # final must have (fail-loud)
    away_goals: int | None

    @property
    def is_final(self) -> bool:
        return self.status == "final"


@dataclass
class TeamOutcome:
    """One team's qualification status under one match-outcome."""
    team_id: str
    status: str               # top2_clinched | advance_clinched | eliminated | alive
    can_win_group: bool
    secured_3rd_or_better: bool
    needs_best_third: bool
    seeding_live: bool        # [A]: clinched top-2 but 1st-vs-2nd not yet pinned
    basis_key: str            # structured i18n key (translated in the frontend)


@dataclass
class MatchScenario:
    """W/D/L × (home, away) status matrix + match-level flags for one pending match."""
    match_id: str
    group_label: str
    home_team: str
    away_team: str
    outcomes: dict[str, tuple[TeamOutcome, TeamOutcome]]  # outcome → (home, away)
    convenience_draw: bool
    convenience_draw_kind: str | None
    dead_rubber: bool


# ---------------------------------------------------------------------------
# Points helpers
# ---------------------------------------------------------------------------

def _apply_outcome(points: dict[str, int], home: str, away: str, outcome: str) -> None:
    """Add the points a W/D/L outcome awards (3/1/0). Mutates ``points``."""
    if outcome == "home":
        points[home] += 3
    elif outcome == "away":
        points[away] += 3
    else:  # draw
        points[home] += 1
        points[away] += 1


def _final_outcome(m: ScenarioMatch) -> str:
    """W/D/L of a final match from its goals."""
    assert m.home_goals is not None and m.away_goals is not None
    if m.home_goals > m.away_goals:
        return "home"
    if m.home_goals < m.away_goals:
        return "away"
    return "draw"


def _bands(points: dict[str, int]) -> dict[str, tuple[int, int]]:
    """Points-band: team → (min_rank, max_rank), 1-based.

    Teams strictly above on points pin the band floor; teams level on points
    (including self) span the band — their internal order is undetermined
    (GD/GF/H2H/lots), so every rank in [a+1, a+e] is possible (spec §5.2).
    """
    teams = list(points)
    out: dict[str, tuple[int, int]] = {}
    for t in teams:
        a = sum(1 for o in teams if points[o] > points[t])      # strictly above
        e = sum(1 for o in teams if points[o] == points[t])     # level (incl. self)
        out[t] = (a + 1, a + e)
    return out


# ---------------------------------------------------------------------------
# Per-(match, outcome) classification
# ---------------------------------------------------------------------------

def _classify(team_id: str, min_rank: int, max_rank: int,
              always_top2: bool, always_4th: bool, always_top3: bool,
              can_be_3rd: bool) -> TeamOutcome:
    if always_top2:
        status = STATUS_TOP2
    elif always_4th:
        status = STATUS_ELIMINATED
    else:
        status = STATUS_ALIVE

    can_win = min_rank == 1
    secured3 = always_top3
    needs_third = (not always_top2) and (not always_4th) and can_be_3rd
    seeding_live = always_top2 and (min_rank != max_rank)

    if status == STATUS_TOP2:
        if min_rank == max_rank == 1:
            basis = "clinched_first"
        elif min_rank == max_rank == 2:
            basis = "clinched_second"
        else:
            basis = "clinched_top2"
    elif status == STATUS_ELIMINATED:
        basis = "eliminated"
    elif secured3:
        basis = "secured_third_needs_race"
    elif can_be_3rd:
        basis = "alive_can_third"
    else:
        basis = "alive"

    return TeamOutcome(
        team_id=team_id,
        status=status,
        can_win_group=can_win,
        secured_3rd_or_better=secured3,
        needs_best_third=needs_third,
        seeding_live=seeding_live,
        basis_key=basis,
    )


def _analyze_outcome(
    team_ids: list[str],
    base_points: dict[str, int],
    target: ScenarioMatch,
    target_outcome: str,
    variable: list[ScenarioMatch],
) -> dict[str, TeamOutcome]:
    """For ``target=target_outcome`` fixed, enumerate the group's OTHER pending
    matches over W/D/L and aggregate each team's possible-rank set → TeamOutcome.
    """
    agg = {
        t: {"min": 99, "max": 0, "can3": False,
            "always_top2": True, "always_4th": True, "always_top3": True}
        for t in team_ids
    }

    for combo in itertools.product(OUTCOMES, repeat=len(variable)):
        pts = dict(base_points)
        _apply_outcome(pts, target.home_team, target.away_team, target_outcome)
        for m, o in zip(variable, combo):
            _apply_outcome(pts, m.home_team, m.away_team, o)

        for tid, (lo, hi) in _bands(pts).items():
            a = agg[tid]
            if lo < a["min"]:
                a["min"] = lo
            if hi > a["max"]:
                a["max"] = hi
            if lo <= 3 <= hi:
                a["can3"] = True
            if hi > 2:
                a["always_top2"] = False
            if lo != 4:                 # band == [4,4] iff lo == 4
                a["always_4th"] = False
            if hi > 3:
                a["always_top3"] = False

    return {
        tid: _classify(
            tid, a["min"], a["max"],
            a["always_top2"], a["always_4th"], a["always_top3"], a["can3"],
        )
        for tid, a in agg.items()
    }


def _convenience(draw_status: dict[str, TeamOutcome],
                 home: str, away: str) -> tuple[bool, str | None]:
    """Convenience-draw flag from the draw-outcome statuses of the two teams (spec §4)."""
    h, a = draw_status[home], draw_status[away]
    if h.status == STATUS_TOP2 and a.status == STATUS_TOP2:
        return True, KIND_TOP2  # strong (Gijón-style): a draw locks both into top-2
    if (h.secured_3rd_or_better and a.secured_3rd_or_better
            and (h.needs_best_third or a.needs_best_third)):
        # weaker, cross-group-dependent signal — NOT a fact-level convenience draw
        return False, KIND_MUTUAL_3RD
    return False, None


def _dead_rubber(per_outcome: dict[str, dict[str, TeamOutcome]],
                 home: str, away: str) -> bool:
    """A match changes nothing for either team (spec §4, [A]): for both teams,
    status is identical & terminal across all three outcomes, and never seeding_live.
    """
    for team in (home, away):
        outs = [per_outcome[o][team] for o in OUTCOMES]
        s0 = outs[0].status
        if s0 not in (STATUS_TOP2, STATUS_ELIMINATED):
            return False
        if any(o.status != s0 for o in outs):
            return False
        if any(o.seeding_live for o in outs):
            return False
    return True


# ---------------------------------------------------------------------------
# Group entry point
# ---------------------------------------------------------------------------

def analyze_group(group_label: str, matches: list[ScenarioMatch]) -> list[MatchScenario]:
    """Scenario analysis for one group's pending matches.

    ``matches`` = all of the group's matches (final + pending). Returns one
    MatchScenario per pending (``status != 'final'``) match; final matches yield
    nothing (spec §8.2 invariant: the table never holds a final match's rows).

    fail-loud: the group must have exactly 4 teams; final matches must have goals;
    team ids must be consistent.
    """
    team_ids = sorted({t for m in matches for t in (m.home_team, m.away_team)})
    if len(team_ids) != 4:
        raise ValueError(
            f"Group {group_label} has {len(team_ids)} teams, expected 4 (fail-loud)"
        )

    finals: list[ScenarioMatch] = []
    pending: list[ScenarioMatch] = []
    for m in matches:
        if m.is_final:
            if m.home_goals is None or m.away_goals is None:
                raise ValueError(
                    f"Final match {m.match_id} missing goals (verify-don't-assume)"
                )
            finals.append(m)
        else:
            pending.append(m)

    base_points = {t: 0 for t in team_ids}
    for m in finals:
        _apply_outcome(base_points, m.home_team, m.away_team, _final_outcome(m))

    scenarios: list[MatchScenario] = []
    for target in pending:
        variable = [m for m in pending if m.match_id != target.match_id]
        per_outcome = {
            o: _analyze_outcome(team_ids, base_points, target, o, variable)
            for o in OUTCOMES
        }
        outcomes = {
            o: (per_outcome[o][target.home_team], per_outcome[o][target.away_team])
            for o in OUTCOMES
        }
        conv, kind = _convenience(per_outcome["draw"], target.home_team, target.away_team)
        scenarios.append(MatchScenario(
            match_id=target.match_id,
            group_label=group_label,
            home_team=target.home_team,
            away_team=target.away_team,
            outcomes=outcomes,
            convenience_draw=conv,
            convenience_draw_kind=kind,
            dead_rubber=_dead_rubber(per_outcome, target.home_team, target.away_team),
        ))
    return scenarios
