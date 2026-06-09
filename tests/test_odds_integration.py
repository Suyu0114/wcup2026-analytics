"""TO de-vig / coverage against ingested odds (spec §6) — skip until data exists.

Reads odds_closing (one row per outcome). Skips cleanly if Supabase creds, the
table, or data are absent, so the offline suite stays green before ingest.
"""
from collections import defaultdict

import pytest

from engine.value import novig


def _pinnacle_closing_or_skip() -> list[dict]:
    try:
        from etl import db
        data = (
            db.get_client()
            .table("odds_closing")
            .select("match_id,bookmaker,market,outcome,point,decimal_odds")
            .eq("bookmaker", "pinnacle")
            .execute()
            .data
        )
    except Exception as e:  # no creds / view missing
        pytest.skip(f"odds_closing unavailable: {e}")
    if not data:
        pytest.skip("odds_closing empty — run `python -m etl.ingest_odds` first")
    return data


def test_to3_pinnacle_totals_have_point_and_both_sides():
    rows = [r for r in _pinnacle_closing_or_skip() if r["market"] == "totals"]
    assert rows, "no Pinnacle totals"
    assert all(r["point"] is not None for r in rows)
    sides = defaultdict(set)
    for r in rows:
        sides[(r["match_id"], float(r["point"]))].add(r["outcome"])
    assert all({"over", "under"} <= s for s in sides.values())


def test_to4_pinnacle_h2h_devig_sums_to_one():
    by_match = defaultdict(dict)
    for r in _pinnacle_closing_or_skip():
        if r["market"] == "h2h":
            by_match[r["match_id"]][r["outcome"]] = float(r["decimal_odds"])
    checked = 0
    for prices in by_match.values():
        if {"home", "draw", "away"} <= set(prices):
            assert abs(sum(novig(prices).values()) - 1.0) < 1e-6
            checked += 1
    assert checked > 0


def test_to5_pinnacle_totals_devig_sums_to_one():
    by_line = defaultdict(dict)
    for r in _pinnacle_closing_or_skip():
        if r["market"] == "totals":
            by_line[(r["match_id"], float(r["point"]))][r["outcome"]] = float(r["decimal_odds"])
    checked = 0
    for prices in by_line.values():
        if {"over", "under"} <= set(prices):
            assert abs(sum(novig(prices).values()) - 1.0) < 1e-6
            checked += 1
    assert checked > 0
