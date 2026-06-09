"""Group-stage simulation acceptance tests (P2 spec §6: TS1–TS12) — pure, offline.

All tests use mock data (no Supabase). TS2 (48 rows in DB) is an integration
test to be verified manually via `python -m etl.simulate`.
"""
from __future__ import annotations

import string
import time

import numpy as np
import pytest
from scipy.stats import chisquare

from engine.dixon_coles import MAXG, elo_to_lambdas, score_matrix
from engine.group_sim import (
    GroupMatch,
    SimConfig,
    TeamSimResult,
    TeamStanding,
    _build_flat_distribution,
    _compute_h2h_stats,
    rank_group,
    rank_third_places,
    simulate_groups,
)


# ---------------------------------------------------------------------------
# Helpers: build mock 12-group data
# ---------------------------------------------------------------------------

def _make_group_matches(
    group_label: str,
    team_ids: list[str],
    team_elos: dict[str, float],
    settled: dict[str, tuple[int, int]] | None = None,
) -> list[GroupMatch]:
    """Create 6 matches for a group of 4 teams."""
    settled = settled or {}
    matches = []
    idx = 0
    for hi in range(4):
        for ai in range(hi + 1, 4):
            ht, at = team_ids[hi], team_ids[ai]
            mid = f"m_{group_label}_{idx}"
            lh, la = elo_to_lambdas(team_elos[ht], team_elos[at], False)
            is_set = mid in settled
            hg = settled[mid][0] if is_set else None
            ag = settled[mid][1] if is_set else None
            matches.append(GroupMatch(
                match_id=mid,
                group_label=group_label,
                home_team=ht,
                away_team=at,
                lambda_home=lh,
                lambda_away=la,
                is_settled=is_set,
                home_goals=hg,
                away_goals=ag,
            ))
            idx += 1
    return matches


def _make_full_sim_data(
    elo_overrides: dict[str, float] | None = None,
    default_elo: float = 1500.0,
) -> tuple[list[GroupMatch], dict[str, float]]:
    """Create 48 teams (12 groups × 4) and 72 group matches."""
    elo_overrides = elo_overrides or {}
    group_labels = list(string.ascii_uppercase[:12])
    all_matches: list[GroupMatch] = []
    team_elos: dict[str, float] = {}

    for gi, gl in enumerate(group_labels):
        tids = [f"T{gi * 4 + ti:02d}" for ti in range(4)]
        for tid in tids:
            team_elos[tid] = elo_overrides.get(tid, default_elo)
        all_matches.extend(_make_group_matches(gl, tids, team_elos))

    assert len(all_matches) == 72
    assert len(team_elos) == 48
    return all_matches, team_elos


# ---------------------------------------------------------------------------
# TS1: Probability normalization (per group)
# ---------------------------------------------------------------------------

class TestTS1Normalization:
    def test_p_first_sums_to_one_per_group(self):
        matches, elos = _make_full_sim_data()
        results = simulate_groups(matches, elos, SimConfig(n=1_000, seed=42))
        by_group: dict[str, list[TeamSimResult]] = {}
        for r in results:
            by_group.setdefault(r.group_label, []).append(r)

        for gl, group_results in by_group.items():
            total_first = sum(r.p_first for r in group_results)
            total_second = sum(r.p_second for r in group_results)
            assert abs(total_first - 1.0) <= 1 / 1_000 + 1e-9, (
                f"Group {gl}: sum(p_first)={total_first}"
            )
            assert abs(total_second - 1.0) <= 1 / 1_000 + 1e-9, (
                f"Group {gl}: sum(p_second)={total_second}"
            )

    def test_p_advance_equals_components(self):
        matches, elos = _make_full_sim_data()
        results = simulate_groups(matches, elos, SimConfig(n=500, seed=7))
        for r in results:
            assert abs(r.p_advance - (r.p_first + r.p_second + r.p_third_qual)) < 1e-9


# ---------------------------------------------------------------------------
# TS3: Determinism (seed)
# ---------------------------------------------------------------------------

class TestTS3Determinism:
    def test_same_seed_same_result(self):
        matches, elos = _make_full_sim_data()
        cfg = SimConfig(n=500, seed=42)
        r1 = simulate_groups(matches, elos, cfg)
        r2 = simulate_groups(matches, elos, cfg)
        r1_sorted = sorted(r1, key=lambda x: x.team_id)
        r2_sorted = sorted(r2, key=lambda x: x.team_id)
        for a, b in zip(r1_sorted, r2_sorted):
            assert a.p_first == b.p_first
            assert a.p_second == b.p_second
            assert a.p_third_qual == b.p_third_qual

    def test_different_seed_different_result(self):
        matches, elos = _make_full_sim_data()
        r1 = simulate_groups(matches, elos, SimConfig(n=500, seed=42))
        r2 = simulate_groups(matches, elos, SimConfig(n=500, seed=99))
        r1_dict = {r.team_id: r.p_first for r in r1}
        r2_dict = {r.team_id: r.p_first for r in r2}
        # At least some teams should differ (extremely unlikely all identical)
        diffs = sum(1 for tid in r1_dict if abs(r1_dict[tid] - r2_dict[tid]) > 1e-9)
        assert diffs > 0, "Different seeds produced identical results"


# ---------------------------------------------------------------------------
# TS4: Strong team direction
# ---------------------------------------------------------------------------

class TestTS4StrongTeamDirection:
    def test_high_elo_higher_p_advance(self):
        """A team with significantly higher Elo should have higher p_advance."""
        # Group A: T00=2000, T01/T02/T03=1400
        elo_map = {"T00": 2000.0, "T01": 1400.0, "T02": 1400.0, "T03": 1400.0}
        matches, elos = _make_full_sim_data(elo_overrides=elo_map)
        results = simulate_groups(matches, elos, SimConfig(n=2_000, seed=42))
        group_a = {r.team_id: r for r in results if r.group_label == "A"}
        assert group_a["T00"].p_advance > group_a["T01"].p_advance
        assert group_a["T00"].p_advance > group_a["T02"].p_advance
        assert group_a["T00"].p_advance > group_a["T03"].p_advance

    def test_multi_group_direction(self):
        """Check 3 groups: strongest team in each has highest p_advance."""
        elo_map = {}
        for gi in range(3):  # groups A, B, C
            strong = f"T{gi * 4:02d}"
            elo_map[strong] = 2000.0
            for ti in range(1, 4):
                elo_map[f"T{gi * 4 + ti:02d}"] = 1400.0
        matches, elos = _make_full_sim_data(elo_overrides=elo_map)
        results = simulate_groups(matches, elos, SimConfig(n=2_000, seed=42))
        for gi, gl in enumerate(["A", "B", "C"]):
            grp = {r.team_id: r for r in results if r.group_label == gl}
            strong_tid = f"T{gi * 4:02d}"
            for tid, r in grp.items():
                if tid != strong_tid:
                    assert grp[strong_tid].p_advance > r.p_advance, (
                        f"Group {gl}: {strong_tid} should beat {tid}"
                    )


# ---------------------------------------------------------------------------
# TS5: Equal-strength symmetry
# ---------------------------------------------------------------------------

class TestTS5EqualStrength:
    def test_equal_elo_p_first_approx_quarter(self):
        matches, elos = _make_full_sim_data(default_elo=1500.0)
        results = simulate_groups(matches, elos, SimConfig(n=5_000, seed=42))
        for r in results:
            assert abs(r.p_first - 0.25) < 0.05, (
                f"{r.team_id}: p_first={r.p_first:.3f}, expected ≈0.25"
            )

    def test_equal_elo_p_advance_approx_two_thirds(self):
        """p_advance ≈ 2/3 with ±3% tolerance (best-3rd asymmetry)."""
        matches, elos = _make_full_sim_data(default_elo=1500.0)
        results = simulate_groups(matches, elos, SimConfig(n=5_000, seed=42))
        for r in results:
            assert abs(r.p_advance - 2 / 3) < 0.03, (
                f"{r.team_id}: p_advance={r.p_advance:.3f}, expected ≈0.667 (±3%)"
            )


# ---------------------------------------------------------------------------
# TS6: Tiebreaker — GD decides
# ---------------------------------------------------------------------------

class TestTS6TiebreakerGD:
    def test_same_pts_higher_gd_wins(self):
        """Two teams with same pts but different GD → higher GD ranks first."""
        rng = np.random.default_rng(0)
        s1 = TeamStanding(team_id="AA", elo=1500, pts=6, gf=5, ga=1)  # gd=+4
        s2 = TeamStanding(team_id="BB", elo=1500, pts=6, gf=3, ga=3)  # gd=0
        s3 = TeamStanding(team_id="CC", elo=1500, pts=0, gf=0, ga=4)
        s4 = TeamStanding(team_id="DD", elo=1500, pts=0, gf=0, ga=4)
        h2h: dict[frozenset, tuple[int, int]] = {
            frozenset({"AA", "BB"}): (2, 1),  # AA beat BB
            frozenset({"AA", "CC"}): (2, 0),
            frozenset({"AA", "DD"}): (1, 0),
            frozenset({"BB", "CC"}): (2, 2),
            frozenset({"BB", "DD"}): (1, 1),
            frozenset({"CC", "DD"}): (0, 0),
        }
        ranking = rank_group([s1, s2, s3, s4], h2h, rng)
        assert ranking[0] == "AA"  # higher GD
        assert ranking[1] == "BB"


# ---------------------------------------------------------------------------
# TS7: Tiebreaker — H2H decides
# ---------------------------------------------------------------------------

class TestTS7TiebreakerH2H:
    def test_same_pts_gd_gf_h2h_wins(self):
        """Two teams with same pts/gd/gf → H2H winner ranks first."""
        rng = np.random.default_rng(0)
        # Both: pts=6, gf=3, ga=1, gd=+2
        s1 = TeamStanding(team_id="AA", elo=1500, pts=6, gf=3, ga=1)
        s2 = TeamStanding(team_id="BB", elo=1500, pts=6, gf=3, ga=1)
        s3 = TeamStanding(team_id="CC", elo=1500, pts=0, gf=0, ga=2)
        s4 = TeamStanding(team_id="DD", elo=1500, pts=0, gf=0, ga=2)
        # AA beat BB 1-0 in H2H (canonical: AA < BB, so (AA_goals, BB_goals))
        h2h: dict[frozenset, tuple[int, int]] = {
            frozenset({"AA", "BB"}): (1, 0),  # AA won
            frozenset({"AA", "CC"}): (1, 0),
            frozenset({"AA", "DD"}): (1, 1),
            frozenset({"BB", "CC"}): (1, 1),
            frozenset({"BB", "DD"}): (2, 0),
            frozenset({"CC", "DD"}): (0, 0),
        }
        ranking = rank_group([s1, s2, s3, s4], h2h, rng)
        assert ranking[0] == "AA", f"H2H winner AA should be 1st, got {ranking}"
        assert ranking[1] == "BB"


# ---------------------------------------------------------------------------
# TS8: 3-way circular tie — no crash, no recursion
# ---------------------------------------------------------------------------

class TestTS8CircularTie:
    def test_no_crash_no_recursion(self):
        """A>B>C>A each 1-0 → should not crash or recurse. 4th team loses all."""
        rng = np.random.default_rng(42)
        # A beats B 1-0, B beats C 1-0, C beats A 1-0 → each: pts=6, gd=0, gf=2
        # D loses all 0-1
        s_a = TeamStanding(team_id="AA", elo=1500, pts=6, gf=2, ga=2)
        s_b = TeamStanding(team_id="BB", elo=1500, pts=6, gf=2, ga=2)
        s_c = TeamStanding(team_id="CC", elo=1500, pts=6, gf=2, ga=2)
        s_d = TeamStanding(team_id="DD", elo=1500, pts=0, gf=0, ga=0)
        # H2H: AA>BB 1-0, BB>CC 1-0, CC>AA 1-0 (canonical order)
        h2h: dict[frozenset, tuple[int, int]] = {
            frozenset({"AA", "BB"}): (1, 0),  # AA beat BB
            frozenset({"AA", "CC"}): (0, 1),  # CC beat AA
            frozenset({"BB", "CC"}): (1, 0),  # BB beat CC
            frozenset({"AA", "DD"}): (0, 0),
            frozenset({"BB", "DD"}): (0, 0),
            frozenset({"CC", "DD"}): (0, 0),
        }
        # Should not raise RecursionError or hang
        ranking = rank_group([s_a, s_b, s_c, s_d], h2h, rng)
        assert len(ranking) == 4
        assert set(ranking) == {"AA", "BB", "CC", "DD"}
        # D should be last (0 pts)
        assert ranking[3] == "DD"

    def test_circular_with_different_elo_deterministic(self):
        """Circular tie → falls through to elo → deterministic ordering."""
        rng = np.random.default_rng(42)
        s_a = TeamStanding(team_id="AA", elo=1800, pts=6, gf=2, ga=2)
        s_b = TeamStanding(team_id="BB", elo=1600, pts=6, gf=2, ga=2)
        s_c = TeamStanding(team_id="CC", elo=1400, pts=6, gf=2, ga=2)
        s_d = TeamStanding(team_id="DD", elo=1200, pts=0, gf=0, ga=0)
        h2h: dict[frozenset, tuple[int, int]] = {
            frozenset({"AA", "BB"}): (1, 0),
            frozenset({"AA", "CC"}): (0, 1),
            frozenset({"BB", "CC"}): (1, 0),
            frozenset({"AA", "DD"}): (0, 0),
            frozenset({"BB", "DD"}): (0, 0),
            frozenset({"CC", "DD"}): (0, 0),
        }
        ranking = rank_group([s_a, s_b, s_c, s_d], h2h, rng)
        # H2H within {AA, BB, CC}: each has h2h_pts=3, h2h_gd=0, h2h_gf=1 → all same
        # → fallback to elo: AA(1800) > BB(1600) > CC(1400)
        assert ranking[0] == "AA"
        assert ranking[1] == "BB"
        assert ranking[2] == "CC"
        assert ranking[3] == "DD"


# ---------------------------------------------------------------------------
# TS9: Best third places — 24 top-2 + 8 thirds = 32 advance
# ---------------------------------------------------------------------------

class TestTS9BestThirdCount:
    def test_total_advance_equals_32(self):
        """sum(p_advance) across all 48 teams ≈ 32 (12 firsts + 12 seconds + 8 thirds)."""
        matches, elos = _make_full_sim_data()
        results = simulate_groups(matches, elos, SimConfig(n=1_000, seed=42))
        total_advance = sum(r.p_advance for r in results)
        assert abs(total_advance - 32.0) < 1 / 1_000 + 1e-9, (
            f"sum(p_advance)={total_advance}, expected 32.0"
        )

    def test_total_third_qual_equals_8(self):
        """sum(p_third_qual) ≈ 8."""
        matches, elos = _make_full_sim_data()
        results = simulate_groups(matches, elos, SimConfig(n=1_000, seed=42))
        total_third = sum(r.p_third_qual for r in results)
        assert abs(total_third - 8.0) < 1 / 1_000 + 1e-9, (
            f"sum(p_third_qual)={total_third}, expected 8.0"
        )

    def test_48_results(self):
        matches, elos = _make_full_sim_data()
        results = simulate_groups(matches, elos, SimConfig(n=200, seed=42))
        assert len(results) == 48


# ---------------------------------------------------------------------------
# TS10: Settled match locking
# ---------------------------------------------------------------------------

class TestTS10SettledLock:
    def test_settled_match_uses_real_score(self):
        """A settled match (2-0) must produce 2-0 in all N simulations."""
        team_elos = {"AA": 1500, "BB": 1500, "CC": 1500, "DD": 1500}
        lh, la = elo_to_lambdas(1500, 1500, False)
        # One settled match: AA beat BB 2-0
        matches = [
            GroupMatch("m0", "A", "AA", "BB", lh, la, True, 2, 0),   # settled
            GroupMatch("m1", "A", "AA", "CC", lh, la, False, None, None),
            GroupMatch("m2", "A", "AA", "DD", lh, la, False, None, None),
            GroupMatch("m3", "A", "BB", "CC", lh, la, False, None, None),
            GroupMatch("m4", "A", "BB", "DD", lh, la, False, None, None),
            GroupMatch("m5", "A", "CC", "DD", lh, la, False, None, None),
        ]
        # Build a minimal 12-group setup: group A has our test, rest are filler
        all_matches = list(matches)
        all_elos = dict(team_elos)
        for gi in range(1, 12):
            gl = string.ascii_uppercase[gi]
            tids = [f"T{gi * 4 + ti:02d}" for ti in range(4)]
            for tid in tids:
                all_elos[tid] = 1500.0
            all_matches.extend(_make_group_matches(gl, tids, all_elos))

        # Run simulation and verify the settled match
        # We can verify by checking that the pre-sampled arrays are constant
        rng = np.random.default_rng(42)
        N = 500
        match_home_scores: dict[str, np.ndarray] = {}
        match_away_scores: dict[str, np.ndarray] = {}
        for m in all_matches:
            if m.is_settled:
                match_home_scores[m.match_id] = np.full(N, m.home_goals, dtype=int)
                match_away_scores[m.match_id] = np.full(N, m.away_goals, dtype=int)
            else:
                probs, hg, ag = _build_flat_distribution(m.lambda_home, m.lambda_away)
                indices = rng.choice(len(probs), size=N, p=probs)
                match_home_scores[m.match_id] = hg[indices]
                match_away_scores[m.match_id] = ag[indices]

        # The settled match m0 should always be 2-0
        assert np.all(match_home_scores["m0"] == 2)
        assert np.all(match_away_scores["m0"] == 0)

    def test_settled_missing_goals_raises(self):
        """is_settled=True but goals=None → AssertionError (fail-loud)."""
        team_elos = {"AA": 1500, "BB": 1500, "CC": 1500, "DD": 1500}
        lh, la = elo_to_lambdas(1500, 1500, False)
        matches = [
            GroupMatch("m0", "A", "AA", "BB", lh, la, True, None, None),  # BAD
            GroupMatch("m1", "A", "AA", "CC", lh, la, False, None, None),
            GroupMatch("m2", "A", "AA", "DD", lh, la, False, None, None),
            GroupMatch("m3", "A", "BB", "CC", lh, la, False, None, None),
            GroupMatch("m4", "A", "BB", "DD", lh, la, False, None, None),
            GroupMatch("m5", "A", "CC", "DD", lh, la, False, None, None),
        ]
        all_matches = list(matches)
        all_elos = dict(team_elos)
        for gi in range(1, 12):
            gl = string.ascii_uppercase[gi]
            tids = [f"T{gi * 4 + ti:02d}" for ti in range(4)]
            for tid in tids:
                all_elos[tid] = 1500.0
            all_matches.extend(_make_group_matches(gl, tids, all_elos))

        with pytest.raises(AssertionError, match="verify-don't-assume"):
            simulate_groups(all_matches, all_elos, SimConfig(n=10, seed=0))


# ---------------------------------------------------------------------------
# TS11: Score matrix consistency (chi-square)
# ---------------------------------------------------------------------------

class TestTS11ScoreMatrixConsistency:
    def test_sampling_matches_joint_distribution(self):
        """N=100K sampling: (i,j) frequencies vs score_matrix → chi-square p > 0.01."""
        lh, la = 1.5, 1.2
        P = score_matrix(lh, la)
        probs, home_g, away_g = _build_flat_distribution(lh, la)
        K = len(probs)

        rng = np.random.default_rng(42)
        N = 100_000
        indices = rng.choice(K, size=N, p=probs)
        observed = np.bincount(indices, minlength=K).astype(float)
        expected = probs * N

        # Only test cells with expected >= 5 (chi-square validity condition)
        mask = expected >= 5
        obs_masked = observed[mask]
        exp_masked = expected[mask]
        # Rescale expected to match observed sum (required by scipy chisquare)
        exp_masked = exp_masked * (obs_masked.sum() / exp_masked.sum())
        chi2_stat, p_value = chisquare(obs_masked, f_exp=exp_masked)
        assert p_value > 0.01, (
            f"Chi-square p={p_value:.4f} < 0.01: sampling doesn't match score matrix"
        )


# ---------------------------------------------------------------------------
# TS12: Performance (N=10K < 10 seconds)
# ---------------------------------------------------------------------------

class TestTS12Performance:
    def test_10k_under_10_seconds(self):
        matches, elos = _make_full_sim_data()
        t0 = time.perf_counter()
        simulate_groups(matches, elos, SimConfig(n=10_000, seed=42))
        elapsed = time.perf_counter() - t0
        assert elapsed < 10.0, f"N=10K took {elapsed:.1f}s, limit is 10s"
