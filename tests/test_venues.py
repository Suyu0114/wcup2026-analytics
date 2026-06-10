"""Host venue curation acceptance (P6 spec §2.1 / TA1) — pure, offline.

The match->city curation itself is manual (provenance in etl/venues.py); these
tests pin the shape invariants and the fail-loud behavior of host_flags().
"""
import pytest

from etl.venues import HOST_TEAMS, MANUAL_VENUE, STADIUM_COUNTRY, host_flags


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
