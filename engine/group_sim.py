"""Monte Carlo group-stage simulation engine (P2, spec §4).

Pure functions, no I/O — offline-testable (same style as dixon_coles.py / value.py).

Pipeline:
  match_predictions.lambda → score_matrix multinomial sampling (D1)
  → settled-match locking (D3) → group standings + tiebreaker (D4)
  → best-3rd cross-group ranking → per-team advancement probabilities.

Architecture (§4.3 vs §4.5 — hybrid):
  (1) Outer vectorized: per unsettled match → rng.choice(K, size=N)
  (2) Inner per-sim: for sim_i in range(N) → build standings → rank → count
"""
from __future__ import annotations

import string
from dataclasses import dataclass, field

import numpy as np

from engine.dixon_coles import MODEL_VERSION, MAXG, score_matrix
from engine.bracket import KO_MATCHES


# ---------------------------------------------------------------------------
# Data classes (spec §4.1 / §4.4)
# ---------------------------------------------------------------------------

@dataclass
class GroupMatch:
    """One group-stage match with prediction lambdas and optional settled score."""
    match_id: str
    group_label: str           # 'A'..'L'
    home_team: str             # team_id
    away_team: str             # team_id
    lambda_home: float         # from match_predictions
    lambda_away: float
    is_settled: bool           # status == 'final'
    home_goals: int | None     # real score (settled must have)
    away_goals: int | None


@dataclass
class SimConfig:
    """Simulation parameters."""
    n: int = 10_000
    seed: int | None = None    # reproducibility


@dataclass
class TeamSimResult:
    """Simulation output for one team."""
    team_id: str
    group_label: str
    p_first: float
    p_second: float
    p_third_qual: float
    p_advance: float           # = p_first + p_second + p_third_qual
    sim_n: int
    model_version: str


@dataclass
class TeamStanding:
    """Mutable group-stage standing for one team in one simulation."""
    team_id: str
    elo: float                 # for fallback sort (D7)
    pts: int = 0
    gf: int = 0                # goals for
    ga: int = 0                # goals against

    @property
    def gd(self) -> int:
        return self.gf - self.ga


# ---------------------------------------------------------------------------
# §4.2  Score matrix → flat multinomial distribution (D1)
# ---------------------------------------------------------------------------

def _build_flat_distribution(
    lh: float, la: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Score matrix → flat probability vector + (home_goals, away_goals) lookup arrays.

    Returns:
        probs:  shape (K,), K = (MAXG+1)², sums to 1.0
        home_g: shape (K,), integer home goals for each cell
        away_g: shape (K,), integer away goals for each cell
    """
    P = score_matrix(lh, la)
    K = (MAXG + 1) ** 2
    probs = np.empty(K)
    home_g = np.empty(K, dtype=int)
    away_g = np.empty(K, dtype=int)
    idx = 0
    for i in range(MAXG + 1):
        for j in range(MAXG + 1):
            probs[idx] = P[i][j]
            home_g[idx] = i
            away_g[idx] = j
            idx += 1
    return probs, home_g, away_g


# ---------------------------------------------------------------------------
# §4.4  Tiebreaker — two-pass, zero-recursion (D4)
# ---------------------------------------------------------------------------

def _compute_h2h_stats(
    tied: list[TeamStanding],
    h2h_results: dict[frozenset, tuple[int, int]],
    subset_ids: set[str],
) -> dict[str, tuple[int, int, int]]:
    """Compute H2H pts/gd/gf for a subset of tied teams. Pure lookup, no recursion.

    h2h_results maps frozenset({team_a, team_b}) → (a_goals, b_goals)
    where a < b alphabetically.

    Returns: {team_id: (h2h_pts, h2h_gd, h2h_gf)}
    """
    stats: dict[str, list[int]] = {s.team_id: [0, 0, 0] for s in tied}

    for idx_s, s in enumerate(tied):
        for other in tied[idx_s + 1:]:
            pair = frozenset({s.team_id, other.team_id})
            if pair not in h2h_results:
                continue  # shouldn't happen in group stage
            a_goals, b_goals = h2h_results[pair]
            # Determine which team is 'a' (alphabetically first)
            teams_sorted = sorted(pair)
            if s.team_id == teams_sorted[0]:
                sg, og = a_goals, b_goals
            else:
                sg, og = b_goals, a_goals

            # Points
            if sg > og:
                stats[s.team_id][0] += 3
            elif sg == og:
                stats[s.team_id][0] += 1
                stats[other.team_id][0] += 1
            else:
                stats[other.team_id][0] += 3

            # GD, GF
            stats[s.team_id][1] += sg - og
            stats[other.team_id][1] += og - sg
            stats[s.team_id][2] += sg
            stats[other.team_id][2] += og

    return {tid: tuple(v) for tid, v in stats.items()}


def rank_group(
    standings: list[TeamStanding],
    h2h_results: dict[frozenset, tuple[int, int]],
    rng: np.random.Generator,
) -> list[str]:
    """Return team_ids sorted 1st→4th. Two-pass, zero recursion (D4).

    Pass 1: overall (-pts, -gd, -gf)
    Pass 2: within tied subsets → H2H (-h2h_pts, -h2h_gd, -h2h_gf, -elo, random)
    """
    key_fn = lambda s: (-s.pts, -s.gd, -s.gf)
    sorted_overall = sorted(standings, key=key_fn)

    result: list[str] = []
    i = 0
    while i < len(sorted_overall):
        j = i + 1
        while j < len(sorted_overall) and key_fn(sorted_overall[j]) == key_fn(sorted_overall[i]):
            j += 1
        tied = sorted_overall[i:j]

        if len(tied) == 1:
            result.append(tied[0].team_id)
        else:
            # Pass 2: H2H within this tied subset
            subset_ids = {s.team_id for s in tied}
            h2h_stats = _compute_h2h_stats(tied, h2h_results, subset_ids)

            # Final sort: H2H → Elo → random (single pass, no recursion)
            random_tiebreak = {s.team_id: rng.random() for s in tied}
            resolved = sorted(tied, key=lambda s: (
                -h2h_stats[s.team_id][0],     # h2h_pts
                -h2h_stats[s.team_id][1],     # h2h_gd
                -h2h_stats[s.team_id][2],     # h2h_gf
                -s.elo,                        # FIFA rank proxy (D7)
                random_tiebreak[s.team_id],    # lots
            ))
            result.extend(s.team_id for s in resolved)

        i = j
    return result


def rank_third_places(
    thirds: list[TeamStanding],
    rng: np.random.Generator,
) -> list[str]:
    """Rank 12 third-place teams, return top 8 team_ids.

    No H2H (cross-group teams haven't played).
    Sort: -pts, -gd, -gf, -elo, random (spec §3.2).
    """
    random_tb = {s.team_id: rng.random() for s in thirds}
    ranked = sorted(thirds, key=lambda s: (
        -s.pts, -s.gd, -s.gf, -s.elo, random_tb[s.team_id]
    ))
    return [s.team_id for s in ranked[:8]]


# ---------------------------------------------------------------------------
# §4.5  Group standings builder (per simulation)
# ---------------------------------------------------------------------------

def _build_group_standings(
    group_matches: list[GroupMatch],
    sim_results: dict[str, tuple[str, str, int, int]],
    team_elos: dict[str, float],
) -> tuple[list[TeamStanding], dict[frozenset, tuple[int, int]]]:
    """From one simulation's results, build standings + H2H dict for one group.

    sim_results: {match_id: (home_team, away_team, home_goals, away_goals)}
    Returns: (standings, h2h_results) where h2h_results keys are frozenset pairs
             with values (alphabetically-first-team-goals, other-team-goals).
    """
    # Collect teams in this group
    team_ids: set[str] = set()
    for m in group_matches:
        team_ids.add(m.home_team)
        team_ids.add(m.away_team)

    standings = {tid: TeamStanding(team_id=tid, elo=team_elos[tid]) for tid in team_ids}
    h2h_results: dict[frozenset, tuple[int, int]] = {}

    for m in group_matches:
        ht, at, hg, ag = sim_results[m.match_id]

        # Update standings
        standings[ht].gf += hg
        standings[ht].ga += ag
        standings[at].gf += ag
        standings[at].ga += hg

        if hg > ag:
            standings[ht].pts += 3
        elif hg == ag:
            standings[ht].pts += 1
            standings[at].pts += 1
        else:
            standings[at].pts += 3

        # H2H: canonical order (alphabetically first team's goals first)
        pair = frozenset({ht, at})
        teams_sorted = sorted(pair)
        if ht == teams_sorted[0]:
            h2h_results[pair] = (hg, ag)
        else:
            h2h_results[pair] = (ag, hg)

    return list(standings.values()), h2h_results


# ---------------------------------------------------------------------------
# §4.5  Main simulation loop (hybrid: outer vectorized + inner per-sim)
# ---------------------------------------------------------------------------

def _presample(
    matches: list[GroupMatch], rng: np.random.Generator, N: int
) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    """Pre-sample all group-match scores (vectorized). Settled matches lock to the real
    score (D3); unsettled draw from the score-matrix joint distribution (D1). Shared by
    simulate_groups and simulate_tournament."""
    match_home_scores: dict[str, np.ndarray] = {}
    match_away_scores: dict[str, np.ndarray] = {}
    for m in matches:
        if m.is_settled:
            assert m.home_goals is not None and m.away_goals is not None, (
                f"Settled match {m.match_id} missing goals (verify-don't-assume)"
            )
            match_home_scores[m.match_id] = np.full(N, m.home_goals, dtype=int)
            match_away_scores[m.match_id] = np.full(N, m.away_goals, dtype=int)
        else:
            probs, home_g, away_g = _build_flat_distribution(m.lambda_home, m.lambda_away)
            indices = rng.choice(len(probs), size=N, p=probs)
            match_home_scores[m.match_id] = home_g[indices]
            match_away_scores[m.match_id] = away_g[indices]
    return match_home_scores, match_away_scores


def simulate_groups(
    matches: list[GroupMatch],
    team_elos: dict[str, float],
    config: SimConfig,
) -> list[TeamSimResult]:
    """Run N Monte Carlo simulations of the group stage.

    Returns 48 TeamSimResults (one per team).

    Architecture:
      (1) Outer vectorized: per unsettled match → rng.choice(K, size=N) once
      (2) Inner per-sim: for sim_i in range(N) → take row sim_i → rank → count
    """
    rng = np.random.default_rng(config.seed)
    N = config.n

    # --- (1) Pre-sample all match scores (vectorized) ---
    match_home_scores, match_away_scores = _presample(matches, rng, N)

    # --- Build lookup: team → group, and group → matches ---
    team_group: dict[str, str] = {}
    groups: dict[str, list[GroupMatch]] = {}
    for m in matches:
        team_group[m.home_team] = m.group_label
        team_group[m.away_team] = m.group_label
        groups.setdefault(m.group_label, []).append(m)

    all_team_ids = set(team_group.keys())
    counts = {tid: {"first": 0, "second": 0, "third_qual": 0} for tid in all_team_ids}

    sorted_group_labels = sorted(groups.keys())

    # --- (2) Inner loop: per simulation ---
    for sim_i in range(N):
        # Build results dict for this simulation
        sim_results: dict[str, tuple[str, str, int, int]] = {}
        for m in matches:
            hg = int(match_home_scores[m.match_id][sim_i])
            ag = int(match_away_scores[m.match_id][sim_i])
            sim_results[m.match_id] = (m.home_team, m.away_team, hg, ag)

        # Rank each group
        third_place_standings: list[TeamStanding] = []
        for gl in sorted_group_labels:
            gm = groups[gl]
            standings, h2h = _build_group_standings(gm, sim_results, team_elos)
            ranking = rank_group(standings, h2h, rng)

            counts[ranking[0]]["first"] += 1
            counts[ranking[1]]["second"] += 1

            # 3rd place → collect for best-3rd ranking
            third_standing = next(s for s in standings if s.team_id == ranking[2])
            third_place_standings.append(third_standing)

        # Best third places: 12 → top 8 qualify (spec §3.2)
        qualified_thirds = rank_third_places(third_place_standings, rng)
        for tid in qualified_thirds:
            counts[tid]["third_qual"] += 1

    # --- Convert counts → probabilities ---
    return [
        TeamSimResult(
            team_id=tid,
            group_label=team_group[tid],
            p_first=c["first"] / N,
            p_second=c["second"] / N,
            p_third_qual=c["third_qual"] / N,
            p_advance=(c["first"] + c["second"] + c["third_qual"]) / N,
            sim_n=N,
            model_version=MODEL_VERSION,
        )
        for tid, c in counts.items()
    ]


# ---------------------------------------------------------------------------
# P14  Full-tournament Monte Carlo (group resolution reused → R32 via Annex C →
#      single-elimination). Knockout = neutral-site + no-draw (engine/knockout).
# ---------------------------------------------------------------------------

@dataclass
class TeamKnockoutResult:
    """Per-team knockout round-reach + champion probability (P14).

    "reach R32" = qualify = group_sim.p_advance (not re-stored here); this starts at R16.
    """
    team_id: str
    group_label: str
    p_make_r16: float
    p_make_qf: float
    p_make_sf: float
    p_make_final: float
    p_champion: float
    sim_n: int
    model_version: str


@dataclass
class SlotOccupancy:
    """Projected matchups: P(team fills a given bracket slot position).

    Pre-draw: R32 slots only (73–88). Real-bracket mode (P17): the whole tree
    (73–104) — known matches occupy their slots with prob 1.0."""
    match_no: int
    side: str          # 'home' | 'away'
    team_id: str
    prob: float


def simulate_tournament(
    matches: list[GroupMatch],
    team_elos: dict[str, float],
    config: SimConfig,
    ko_states: dict[int, "KnockoutMatchState"] | None = None,
) -> tuple[list[TeamKnockoutResult], list[SlotOccupancy]]:
    """Monte Carlo the FULL tournament: group stage (reusing the P2 resolution) → R32 via
    faithful Annex C → single-elimination to the title.

    Returns (per-team round-reach + champion probabilities for all 48 teams, per-slot
    occupancy). Knockout is neutral-site (no HFA, v1) and no-draw (We; see engine/knockout).
    Each qualifying third's group origin is recovered from the team→group map — no change
    to rank_third_places (P14 §B2). Settled group matches are locked (D3) via _presample.

    P17 real-bracket mode: when ko_states (real knockout rows keyed by match_no) covers
    all 16 R32 matches, FIFA's ACTUAL bracket is authoritative — group sampling and the
    Annex C re-derivation are skipped, resolved winners (fd winner / decisive goals /
    downstream inference) advance deterministically, and slot occupancy covers the whole
    tree (73–104). A settled shootout whose winner isn't knowable yet is sampled via We —
    documented transient until fd supplies it. With ko_states absent/partial the pre-draw
    path runs unchanged (occupancy stays R32-only: pre-draw full-tree occupancy would be
    both speculative and unbounded in row count)."""
    from engine.knockout import (
        assert_real_bracket_consistent,
        play_bracket,
        resolve_r32,
        resolve_real_winners,
    )

    rng = np.random.default_rng(config.seed)
    N = config.n

    team_group: dict[str, str] = {}
    groups: dict[str, list[GroupMatch]] = {}
    for m in matches:
        team_group[m.home_team] = m.group_label
        team_group[m.away_team] = m.group_label
        groups.setdefault(m.group_label, []).append(m)
    sorted_group_labels = sorted(groups.keys())
    all_team_ids = set(team_group)

    champ = {tid: 0 for tid in all_team_ids}
    reach = {tid: {"r16": 0, "qf": 0, "sf": 0, "final": 0} for tid in all_team_ids}
    r32_nos = sorted(n for n, mm in KO_MATCHES.items() if mm["stage"] == "r32")

    # P17: real-bracket mode preconditions (post-draw, all 16 R32 rows stored).
    real_r32: dict[int, tuple[str, str]] | None = None
    fixed_winners: dict[int, str] = {}
    if ko_states and all(no in ko_states for no in r32_nos):
        real_r32 = {
            no: (ko_states[no].home_team, ko_states[no].away_team) for no in r32_nos
        }
        fixed_winners = resolve_real_winners(ko_states)
        assert_real_bracket_consistent(ko_states, fixed_winners)

    occ_nos = sorted(KO_MATCHES) if real_r32 is not None else r32_nos
    occ: dict[tuple[int, str], dict[str, int]] = {
        (no, side): {} for no in occ_nos for side in ("home", "away")
    }

    if real_r32 is not None:
        # Real bracket: no group sampling — every sim plays the same fixed pairings,
        # with unresolved matches sampled via We (and resolved ones locked).
        for _sim_i in range(N):
            champion, reached, played = play_bracket(
                real_r32, team_elos, rng, fixed_winners=fixed_winners
            )
            for no, (h, a) in played.items():
                occ[(no, "home")][h] = occ[(no, "home")].get(h, 0) + 1
                occ[(no, "away")][a] = occ[(no, "away")].get(a, 0) + 1
            champ[champion] += 1
            for tid, stages in reached.items():
                for st in ("r16", "qf", "sf", "final"):
                    if st in stages:
                        reach[tid][st] += 1
        return _tournament_results(
            all_team_ids, team_group, champ, reach, occ, N
        )

    match_home_scores, match_away_scores = _presample(matches, rng, N)

    for sim_i in range(N):
        sim_results: dict[str, tuple[str, str, int, int]] = {}
        for m in matches:
            hg = int(match_home_scores[m.match_id][sim_i])
            ag = int(match_away_scores[m.match_id][sim_i])
            sim_results[m.match_id] = (m.home_team, m.away_team, hg, ag)

        winners: dict[str, str] = {}
        runners_up: dict[str, str] = {}
        third_standings: list[TeamStanding] = []
        for gl in sorted_group_labels:
            standings, h2h = _build_group_standings(groups[gl], sim_results, team_elos)
            ranking = rank_group(standings, h2h, rng)
            winners[gl] = ranking[0]
            runners_up[gl] = ranking[1]
            third_standings.append(next(s for s in standings if s.team_id == ranking[2]))

        # group origin of each qualifying third recovered from team_group (no API change)
        qualified_thirds = rank_third_places(third_standings, rng)  # top 8 team_ids
        thirds_by_group = {team_group[tid]: tid for tid in qualified_thirds}

        r32 = resolve_r32(winners, runners_up, thirds_by_group)
        for no, (h, a) in r32.items():
            occ[(no, "home")][h] = occ[(no, "home")].get(h, 0) + 1
            occ[(no, "away")][a] = occ[(no, "away")].get(a, 0) + 1

        champion, reached, _played = play_bracket(r32, team_elos, rng)
        champ[champion] += 1
        for tid, stages in reached.items():
            for st in ("r16", "qf", "sf", "final"):
                if st in stages:
                    reach[tid][st] += 1

    return _tournament_results(all_team_ids, team_group, champ, reach, occ, N)


def _tournament_results(
    all_team_ids: set[str],
    team_group: dict[str, str],
    champ: dict[str, int],
    reach: dict[str, dict[str, int]],
    occ: dict[tuple[int, str], dict[str, int]],
    N: int,
) -> tuple[list[TeamKnockoutResult], list[SlotOccupancy]]:
    """Counts → probabilities (shared by the real-bracket and pre-draw paths)."""
    team_results = [
        TeamKnockoutResult(
            team_id=tid,
            group_label=team_group[tid],
            p_make_r16=reach[tid]["r16"] / N,
            p_make_qf=reach[tid]["qf"] / N,
            p_make_sf=reach[tid]["sf"] / N,
            p_make_final=reach[tid]["final"] / N,
            p_champion=champ[tid] / N,
            sim_n=N,
            model_version=MODEL_VERSION,
        )
        for tid in sorted(all_team_ids)
    ]
    slot_results = [
        SlotOccupancy(match_no=no, side=side, team_id=tid, prob=cnt / N)
        for (no, side), counts in occ.items()
        for tid, cnt in counts.items()
    ]
    return team_results, slot_results
