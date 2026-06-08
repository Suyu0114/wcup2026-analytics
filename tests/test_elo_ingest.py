"""T0 — Elo ingest data quality (spec §6)."""
from datetime import date

import pytest

from etl import config
from etl.ingest_elo import EXPECTED_TEAMS, validate_teams
from sources.rating_source import CsvRatingSource, Rating

# Tournament-era reference. The CSV carries a 2026-12-31 future-dated row whose
# numbers are copied from the live snapshot; the filter must ignore it.
TODAY = date(2026, 6, 8)


def _ratings() -> list[Rating]:
    return CsvRatingSource(config.ELO_CSV, today=TODAY).get_ratings()


def test_t0_exactly_48_teams():
    assert len(_ratings()) == EXPECTED_TEAMS


def test_t0_team_id_unique():
    ids = [r.team_id for r in _ratings()]
    assert len(set(ids)) == len(ids)


def test_t0_no_null_elo():
    assert all(r.elo == r.elo for r in _ratings())  # NaN != NaN


def test_t0_asof_not_in_future():
    assert all(r.asof <= TODAY for r in _ratings())


def test_t0_future_dated_snapshot_excluded():
    # Must pick the real live snapshot, not the 2026-12-31 year-end clone.
    assert max(r.asof for r in _ratings()) < date(2026, 12, 31)


def test_t0_validate_gate_passes():
    validate_teams(_ratings(), today=TODAY)  # should not raise


def test_t0_validate_gate_raises_on_short_list():
    with pytest.raises(ValueError, match="expected 48"):
        validate_teams(_ratings()[:47], today=TODAY)
