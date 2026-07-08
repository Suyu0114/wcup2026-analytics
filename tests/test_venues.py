"""Host venue curation acceptance (P6 spec §2.1 / TA1) — pure, offline.

The match->city curation itself is manual (provenance in etl/venues.py); these
tests pin the shape invariants and the fail-loud behavior of host_flags().
"""
import pytest

from etl.venues import (
    HOST_TEAMS,
    KNOCKOUT_SCHEDULE,
    KNOCKOUT_VENUE_BY_KICKOFF,
    MANUAL_VENUE,
    STADIUM_COUNTRY,
    host_flags,
    schedule_match_no,
)


def test_stadium_country_shape():
    assert set(STADIUM_COUNTRY.values()) == HOST_TEAMS == {"US", "CA", "MX"}
    counts = {c: sum(1 for v in STADIUM_COUNTRY.values() if v == c) for c in HOST_TEAMS}
    assert counts == {"US": 11, "CA": 2, "MX": 3}          # 16 official venues


def test_manual_venue_covers_nine_group_host_matches():
    assert len(MANUAL_VENUE) >= 9                          # knockout additions allowed later
    assert all(city in STADIUM_COUNTRY for city in MANUAL_VENUE.values())


def test_host_flags_host_home():
    assert host_flags("537327", "MX", "ZA") == (True, False)    # Mexico v South Africa, Azteca


def test_host_flags_host_listed_away():
    # fd round-3 listings: Czechia v Mexico at Mexico City -> host is the away side.
    assert host_flags("537331", "CZ", "MX") == (False, True)


def test_host_flags_non_host_needs_no_venue():
    assert host_flags("999999", "BR", "KR") == (False, False)   # neutral, venue irrelevant


def test_host_flags_missing_venue_for_host_raises():
    with pytest.raises(ValueError, match="TA1"):
        host_flags("000000", "US", "BR")                   # host match not in MANUAL_VENUE


def test_host_flags_unknown_venue_raises():
    with pytest.raises(ValueError, match="unknown venue"):
        host_flags("000000", "US", "BR", fd_venue="Narnia Dome")


def test_host_flags_fd_venue_overrides():
    # If fd starts returning venue strings, they take precedence over curation.
    assert host_flags("000000", "CA", "BR", fd_venue="Toronto") == (True, False)
    assert host_flags("000000", "BR", "CA", fd_venue="Vancouver") == (False, True)
    # Host playing in the *other* hosts' country: no advantage either side.
    assert host_flags("000000", "CA", "BR", fd_venue="Seattle") == (False, False)


# --- Knockout slot schedule (post-draw venue resolution by kick-off) ---

def test_knockout_schedule_shape():
    assert len(KNOCKOUT_VENUE_BY_KICKOFF) == 32                 # m73..m104, FIFA slots
    assert all(v in STADIUM_COUNTRY for v in KNOCKOUT_VENUE_BY_KICKOFF.values())


def test_host_flags_knockout_resolves_via_schedule():
    # m81 (Levi's, Santa Clara): host at home resolves from the slot schedule, no MANUAL row.
    assert host_flags("KO1", "US", "BA", None, "2026-07-02T00:00:00Z") == (True, False)


def test_host_flags_knockout_tolerates_kickoff_drift():
    # 20-min drift from the m79 (Azteca, Mexico City) slot still resolves to the host venue.
    assert host_flags("KO2", "MX", "EC", None, "2026-07-01T01:20:00Z") == (True, False)


def test_host_flags_knockout_host_listed_away():
    # Host as the away side at its own venue (fd's round-3 quirk can recur in knockout).
    assert host_flags("KO3", "XX", "CA", None, "2026-07-07T20:00:00Z") == (False, True)  # m96 Vancouver


def test_host_flags_knockout_non_host_needs_no_venue():
    assert host_flags("KO4", "BR", "JP", None, "2026-06-29T17:00:00Z") == (False, False)


def test_host_flags_knockout_unscheduled_kickoff_raises():
    # A host match whose kick-off matches no slot must fail loud (e.g. a real schedule change).
    with pytest.raises(ValueError, match="TA1"):
        host_flags("KO5", "US", "BR", None, "2026-08-01T12:00:00Z")


# --- P17: kickoff -> FIFA match_no (the bracket-cell join key) ---

def test_knockout_schedule_match_nos_cover_73_to_104():
    nos = {no for no, _ in KNOCKOUT_SCHEDULE.values()}
    assert nos == set(range(73, 105))
    # the derived venue view stays in lockstep with the schedule
    assert KNOCKOUT_VENUE_BY_KICKOFF == {ts: v for ts, (_no, v) in KNOCKOUT_SCHEDULE.items()}


def test_schedule_match_no_exact_and_with_drift():
    assert schedule_match_no("2026-07-02T00:00:00Z") == 81           # m81, Santa Clara
    assert schedule_match_no("2026-07-02T00:20:00+00:00") == 81      # ±75-min window
    assert schedule_match_no("2026-07-19T19:00:00Z") == 104          # the Final


def test_schedule_match_no_unmatched_returns_none():
    assert schedule_match_no("2026-08-01T12:00:00Z") is None
    assert schedule_match_no(None) is None
