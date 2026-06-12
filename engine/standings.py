"""Group-stage display standings (P8).

Pure functions, no I/O — offline-testable (same style as group_sim.py / value.py).

Builds the FIFA-style standings table (Played / W / D / L / GF / GA / GD / Pts)
from finished group matches, ranked with the DISPLAY tiebreaker:

    Pts → GD → GF → head-to-head(pts, gd, gf among the tied subset)

Teams that remain exactly level after head-to-head are left in a deterministic
order (team_id alphabetical) and flagged ``tied`` — we do NOT invent a further
separator. Real FIFA next applies fair-play points then drawing of lots, neither
of which we can compute (no card data, no lots) → an honest "tied" beats a fake
strict order (data-integrity-over-approximation).

⚠️ This is the DISPLAY ranker, deliberately separate from
``group_sim.rank_group`` — that one appends …→Elo→random to force a strict order
for Monte Carlo counting, which would be wrong (and misleading) for a real table.
The head-to-head math is shared via ``group_sim._compute_h2h_stats`` (single source).
"""
from __future__ import annotations

from dataclasses import dataclass

from engine.group_sim import _compute_h2h_stats


@dataclass
class StandingRow:
    """One team's row in a group standings table."""
    team_id: str
    played: int = 0
    wins: int = 0
    draws: int = 0
    losses: int = 0
    gf: int = 0                # goals for
    ga: int = 0                # goals against
    pts: int = 0
    rank: int = 0              # 1-based final position
    tied: bool = False         # could not be separated from an adjacent team (footnote-worthy)

    @property
    def gd(self) -> int:
        return self.gf - self.ga


def compute_group_standings(
    team_ids: list[str],
    finished: list[tuple[str, str, int, int]],
) -> list[StandingRow]:
    """Ranked standings for one group.

    Args:
        team_ids: every team in the group, so the table shows all four even before
                  kickoff (FIFA shows everyone on 0).
        finished: settled matches only, as (home_team, away_team, home_goals, away_goals).
                  Caller MUST exclude scheduled/unsettled fixtures.

    Returns rows ordered 1st→last with ``rank`` and ``tied`` assigned. Deterministic:
    no Elo, no randomness.
    """
    rows: dict[str, StandingRow] = {tid: StandingRow(team_id=tid) for tid in team_ids}
    # H2H among group teams: frozenset(pair) → alphabetically-first team's goals first
    h2h_results: dict[frozenset, tuple[int, int]] = {}

    for home, away, hg, ag in finished:
        for t in (home, away):
            if t not in rows:
                raise ValueError(f"match team {t!r} not in group team list (fail-loud)")
        rows[home].played += 1
        rows[away].played += 1
        rows[home].gf += hg
        rows[home].ga += ag
        rows[away].gf += ag
        rows[away].ga += hg
        if hg > ag:
            rows[home].pts += 3
            rows[home].wins += 1
            rows[away].losses += 1
        elif hg == ag:
            rows[home].pts += 1
            rows[away].pts += 1
            rows[home].draws += 1
            rows[away].draws += 1
        else:
            rows[away].pts += 3
            rows[away].wins += 1
            rows[home].losses += 1

        pair = frozenset({home, away})
        first, _second = sorted(pair)          # canonical order (matches group_sim)
        h2h_results[pair] = (hg, ag) if home == first else (ag, hg)

    return _rank(list(rows.values()), h2h_results)


def _rank(
    rows: list[StandingRow],
    h2h_results: dict[frozenset, tuple[int, int]],
) -> list[StandingRow]:
    """Two-pass ranking + tied-flagging. All ``sorted()`` — no recursion, no while-compare
    on data, so even a full H2H cycle (A>B>C>A, equal goals) terminates deterministically."""
    overall = lambda r: (r.pts, r.gd, r.gf)
    # Pass 1: overall desc, team_id asc for a stable, deterministic base order.
    ordered = sorted(rows, key=lambda r: (-r.pts, -r.gd, -r.gf, r.team_id))

    # Full comparison signature per team = overall triple + H2H triple (within its
    # overall-tie subset). Singletons get a zero H2H part — safe because their overall
    # triple is unique across the group (all equal-overall teams are contiguous → one block).
    signature: dict[str, tuple] = {}
    final: list[StandingRow] = []
    i, n = 0, len(ordered)
    while i < n:
        j = i + 1
        while j < n and overall(ordered[j]) == overall(ordered[i]):
            j += 1
        block = ordered[i:j]
        if len(block) == 1:
            r = block[0]
            signature[r.team_id] = (r.pts, r.gd, r.gf, 0, 0, 0)
            final.append(r)
        else:
            h2h = _compute_h2h_stats(block, h2h_results, {r.team_id for r in block})
            resolved = sorted(
                block,
                key=lambda r: (-h2h[r.team_id][0], -h2h[r.team_id][1], -h2h[r.team_id][2], r.team_id),
            )
            for r in resolved:
                signature[r.team_id] = (r.pts, r.gd, r.gf, *h2h[r.team_id])
            final.extend(resolved)
        i = j

    for idx, r in enumerate(final):
        r.rank = idx + 1
    # tied = identical full signature to an adjacent team (such teams sort contiguously).
    for idx, r in enumerate(final):
        sig = signature[r.team_id]
        prev_same = idx > 0 and signature[final[idx - 1].team_id] == sig
        next_same = idx < n - 1 and signature[final[idx + 1].team_id] == sig
        r.tied = prev_same or next_same
    return final
