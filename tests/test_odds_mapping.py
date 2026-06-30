"""Odds ingest + model_total_lines pure mapping logic (spec §4.1 / §4.4) — offline."""
import pytest

from etl.ingest_odds import build_pair_index, map_outcome, pick_match, pinnacle_main_point
from etl.model_lines import TOTALS_GRID, line_probs, totals_distribution
from sources.odds_source import OddsBookmaker, OddsEvent, OddsMarket, OddsOutcome

MATCH = {"match_id": "X", "home_team": "MX", "away_team": "ZA", "kickoff_utc": "2026-06-11T19:00:00+00:00"}
ALIAS = {"Mexico": "MX", "South Africa": "ZA"}


def test_build_pair_index_groups_candidates():
    idx = build_pair_index([MATCH])
    assert idx[frozenset(("MX", "ZA"))] == [MATCH]


def test_pick_match_disambiguates_knockout_rematch():
    # The same pair can meet twice: a settled group game and a later knockout rematch.
    knockout = {"match_id": "K", "home_team": "ZA", "away_team": "MX",
                "kickoff_utc": "2026-07-02T19:00:00+00:00"}
    cands = build_pair_index([MATCH, knockout])[frozenset(("MX", "ZA"))]
    assert len(cands) == 2
    # A live odds event sits next to one fixture's kickoff -> routes there, not the other.
    assert pick_match(cands, "2026-07-02T18:50:00+00:00") is knockout
    assert pick_match(cands, "2026-06-11T18:55:00+00:00") is MATCH


def test_pick_match_empty_returns_none():
    assert pick_match([], "2026-07-02T19:00:00+00:00") is None


def test_map_outcome_h2h_orientation():
    assert map_outcome("h2h", "Mexico", None, MATCH, ALIAS) == ("home", None)
    assert map_outcome("h2h", "South Africa", None, MATCH, ALIAS) == ("away", None)
    assert map_outcome("h2h", "Draw", None, MATCH, ALIAS) == ("draw", None)


def test_map_outcome_totals():
    assert map_outcome("totals", "Over", 2.25, MATCH, ALIAS) == ("over", 2.25)
    assert map_outcome("totals", "Under", 2.25, MATCH, ALIAS) == ("under", 2.25)


def test_map_outcome_unknown_team_raises():
    with pytest.raises(ValueError):
        map_outcome("h2h", "Atlantis", None, MATCH, ALIAS)


def test_pinnacle_main_point_picks_most_balanced():
    ev = OddsEvent("e", "Mexico", "South Africa", "t", [
        OddsBookmaker("pinnacle", [OddsMarket("totals", "u", [
            OddsOutcome("Over", 1.90, 2.25), OddsOutcome("Under", 1.95, 2.25),   # balanced
            OddsOutcome("Over", 2.50, 3.0), OddsOutcome("Under", 1.55, 3.0),     # skewed
        ])]),
    ])
    assert pinnacle_main_point(ev, ALIAS, MATCH) == 2.25


def test_model_line_probs_half_line_sums_to_one():
    t = totals_distribution(1.5, 1.2)
    over, under, push = line_probs(t, 2.5)          # .5 line: no push
    assert push == 0.0
    assert over + under == pytest.approx(1.0)


def test_model_line_probs_uses_lambdas_not_fixed_line():
    # stronger attack -> higher P(over) at the same line
    o_lo = line_probs(totals_distribution(1.0, 0.8), 2.5)[0]
    o_hi = line_probs(totals_distribution(2.2, 1.8), 2.5)[0]
    assert o_hi > o_lo


def test_tb11_grid_shape_and_push():
    """P6 TB11: 13 grid lines; over+under+push ≈ 1; push>0 only on integer lines."""
    assert len(TOTALS_GRID) == 13 and TOTALS_GRID[0] == 1.5 and TOTALS_GRID[-1] == 4.5
    t = totals_distribution(1.4, 1.1)
    for line in TOTALS_GRID:
        over, under, push = line_probs(t, line)
        assert over + under + push == pytest.approx(1.0)
        if line == int(line):
            assert push > 0.0
        else:
            assert push == 0.0


def test_to9_bookmaker_count_keeps_two_credit_cost():
    from etl.ingest_odds import BOOKMAKERS
    assert len(BOOKMAKERS) <= 10          # >10 books would break the 2-credit/call cost model
    assert "pinnacle" in BOOKMAKERS       # sole sharp de-vig baseline
    assert len(set(BOOKMAKERS)) == len(BOOKMAKERS)


def test_to9_cadence_within_quota_budget():
    # spec §4.3 tournament estimate (39 days); 2 credits/call; free tier 500/month.
    CREDITS_PER_CALL = 2
    daily_cron = 39                          # 1 call/day
    pre_kickoff_closing = round(104 * 1.5)   # ~156 manual workflow_dispatch
    buffer = 20
    total_calls = daily_cron + pre_kickoff_closing + buffer   # ~215
    assert total_calls <= 250, total_calls
    assert total_calls * CREDITS_PER_CALL <= 500, total_calls * CREDITS_PER_CALL
