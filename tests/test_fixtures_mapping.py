"""Fixture mapping unit tests (spec §2.2) — pure, offline.

End-to-end TF1–TF4 run against live data via `python -m etl.ingest_fixtures
--dry-run` (needs the API); these cover the deterministic mapping logic.
"""
import pytest

from etl.ingest_fixtures import _has_teams, _kickoff_date, validate
from sources.fixture_source import STAGE_MAP, Fixture, _group_letter


def test_stage_map_covers_all_known_stages():
    assert set(STAGE_MAP) == {
        "GROUP_STAGE", "LAST_32", "LAST_16",
        "QUARTER_FINALS", "SEMI_FINALS", "THIRD_PLACE", "FINAL",
    }
    assert STAGE_MAP["GROUP_STAGE"] == "group"
    assert STAGE_MAP["FINAL"] == "final"


def test_group_letter():
    assert _group_letter("GROUP_F") == "F"
    assert _group_letter("GROUP_L") == "L"
    assert _group_letter(None) is None


def _fx(home="A", away="B", stage="group", group="A", tla_h="AAA", tla_a="BBB"):
    return Fixture(match_id=f"{home}{away}", stage=stage, group_label=group,
                   home_tla=tla_h, home_name=home, away_tla=tla_a, away_name=away,
                   kickoff_utc="2026-06-12T18:00:00Z", status="scheduled")


def test_has_teams_detects_undrawn_knockout():
    assert _has_teams(_fx()) is True
    blank = Fixture("ko1", "r32", None, None, None, None, None, "2026-07-01T18:00:00Z", "scheduled")
    assert _has_teams(blank) is False


def test_kickoff_date_parses_utc():
    assert _kickoff_date("2026-06-11T19:00:00Z").isoformat() == "2026-06-11"


def test_validate_rejects_wrong_total():
    # Only 1 fixture -> fails the upstream 104 sanity check.
    with pytest.raises(ValueError, match="TF1"):
        validate([_fx()], [])
