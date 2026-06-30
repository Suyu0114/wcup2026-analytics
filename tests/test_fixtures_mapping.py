"""Fixture mapping unit tests (spec §2.2) — pure, offline.

End-to-end TF1–TF4 run against live data via `python -m etl.ingest_fixtures
--dry-run` (needs the API); these cover the deterministic mapping logic.
"""
import pytest

from etl.ingest_fixtures import (
    _has_teams,
    _kickoff_date,
    _resolve_score,
    assert_settled_have_goals,
    validate,
)
from sources.fixture_source import (
    STAGE_MAP,
    Fixture,
    FootballDataFixtureSource,
    _group_letter,
)


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


def _fx(home="A", away="B", stage="group", group="A", tla_h="AAA", tla_a="BBB",
        match_id=None, status="scheduled", hg=None, ag=None):
    return Fixture(match_id=match_id or f"{home}{away}", stage=stage, group_label=group,
                   home_tla=tla_h, home_name=home, away_tla=tla_a, away_name=away,
                   kickoff_utc="2026-06-12T18:00:00Z", status=status,
                   home_goals=hg, away_goals=ag)


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


# --- full-time score ingestion (matchday) ---

def _fd_match(mid="537327", status="FINISHED", score=None):
    """A football-data v4 match object (subset get_fixtures reads)."""
    m = {
        "id": mid,
        "stage": "GROUP_STAGE",
        "group": "GROUP_A",
        "homeTeam": {"tla": "MEX", "name": "Mexico"},
        "awayTeam": {"tla": "RSA", "name": "South Africa"},
        "utcDate": "2026-06-11T19:00:00Z",
        "status": status,
        "venue": "Estadio Azteca",
    }
    if score is not None:
        m["score"] = score
    return m


def _src_returning(monkeypatch, matches):
    src = FootballDataFixtureSource(token="dummy", base="http://test")
    monkeypatch.setattr(src, "_get", lambda path: {"matches": matches})
    return src


def test_get_fixtures_extracts_fulltime_score(monkeypatch):
    src = _src_returning(monkeypatch, [
        _fd_match(status="FINISHED", score={"fullTime": {"home": 2, "away": 1}}),
    ])
    fx = src.get_fixtures()[0]
    assert fx.status == "final"
    assert (fx.home_goals, fx.away_goals) == (2, 1)


def test_get_fixtures_scheduled_has_null_goals(monkeypatch):
    # fd returns a fullTime block of nulls for unplayed matches.
    src = _src_returning(monkeypatch, [
        _fd_match(status="SCHEDULED", score={"fullTime": {"home": None, "away": None}}),
    ])
    fx = src.get_fixtures()[0]
    assert fx.status == "scheduled"
    assert fx.home_goals is None and fx.away_goals is None


def test_get_fixtures_handles_missing_score_block(monkeypatch):
    # Pre-tournament payloads may omit the score key entirely.
    src = _src_returning(monkeypatch, [_fd_match(status="TIMED", score=None)])
    fx = src.get_fixtures()[0]
    assert fx.home_goals is None and fx.away_goals is None


def test_assert_settled_have_goals_raises_on_missing():
    final_no_goals = {"match_id": "537327", "status": "final",
                      "home_goals": None, "away_goals": None}
    with pytest.raises(ValueError, match="missing goals"):
        assert_settled_have_goals([final_no_goals])


def test_assert_settled_have_goals_passes_when_present_or_unplayed():
    rows = [
        {"match_id": "1", "status": "final", "home_goals": 2, "away_goals": 1},
        {"match_id": "2", "status": "scheduled", "home_goals": None, "away_goals": None},
    ]
    assert_settled_have_goals(rows)  # no raise


# --- curated results override / final-without-score fallback ---

def test_resolve_score_passes_fd_goals_through():
    assert _resolve_score(_fx(status="final", hg=3, ag=0), {}) == ("final", 3, 0)


def test_resolve_score_override_settles_regardless_of_fd_status():
    # Override is authoritative: settles 'final' even if fd flaps to scheduled/TIMED.
    ov = {"testA": (2, 1)}
    assert _resolve_score(_fx(match_id="testA", status="scheduled"), ov) == ("final", 2, 1)
    assert _resolve_score(_fx(match_id="testA", status="final"), ov) == ("final", 2, 1)


def test_resolve_score_override_agreeing_with_fd_is_fine():
    ov = {"testA": (2, 1)}
    assert _resolve_score(_fx(match_id="testA", status="final", hg=2, ag=1), ov) == ("final", 2, 1)


def test_resolve_score_override_conflicting_with_fd_raises():
    with pytest.raises(ValueError, match="conflicts with football-data"):
        _resolve_score(_fx(match_id="testA", status="final", hg=3, ag=0), {"testA": (2, 1)})


def test_resolve_score_fd_override_wins_over_conflicting_fd(capsys):
    # P12: when the match is flagged override_fd, a conflicting fd score is ignored
    # (curated wins) with a loud warning instead of a raise.
    ov = {"testA": (4, 0)}
    assert _resolve_score(
        _fx(match_id="testA", status="final", hg=5, ag=0), ov, {"testA"}
    ) == ("final", 4, 0)
    assert "WARNING" in capsys.readouterr().out


def test_resolve_score_fd_override_only_applies_to_flagged_match():
    # The flag is per-match: an unflagged conflicting match still fails loud.
    with pytest.raises(ValueError, match="conflicts with football-data"):
        _resolve_score(
            _fx(match_id="testB", status="final", hg=5, ag=0), {"testB": (4, 0)}, {"testA"}
        )


def test_resolve_score_downgrades_final_without_score_or_override():
    # fd FINISHED but null score and no curated entry -> not promoted to final.
    assert _resolve_score(_fx(match_id="999", status="final"), {}) == ("live", None, None)
