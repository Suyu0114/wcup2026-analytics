"""Host-venue curation for HFA (P6 spec §2.1, A1).

football-data returns NO venue for WC2026 (verified 2026-06-10: 0/104 matches),
so host matches are resolved through the curated tables below. fail-loud: a
host match with no resolvable venue raises — that forces a curation update
when e.g. knockout pairings put a host at home (P6 TA1).

⚠️ football-data lists the hosts as the AWAY team in their third group games
(Switzerland v Canada, Czechia v Mexico, Turkey v United States) even though
those are played in Vancouver / Mexico City / Inglewood. We keep football-data's
orientation in `matches` (odds + results ingest align to it) and carry the
advantage on a separate `is_host_away` flag instead (engine applies −HFA to d).

Provenance (curated 2026-06-10):
- match -> city: martj42 intl_results WC2026 schedule rows (city/country,
  neutral=FALSE exactly for these 9), cross-checked against football-data
  opponents + kickoffs (±1 day, local vs UTC) and the official venue list
  (Wikipedia/FIFA: Azteca opener 6/11, Canada & US openers 6/12).
- city -> country: the 16 official host municipalities; unambiguous.
"""
from __future__ import annotations

HOST_TEAMS = {"US", "CA", "MX"}  # Elo two-letter codes (verified from Elo CSV is_host)

# 16 official venues keyed by municipality string (as used in our curated sources).
STADIUM_COUNTRY = {
    # United States (11)
    "Arlington": "US",        # AT&T Stadium (Dallas)
    "Atlanta": "US",          # Mercedes-Benz Stadium
    "East Rutherford": "US",  # MetLife Stadium (NY/NJ)
    "Foxborough": "US",       # Gillette Stadium (Boston)
    "Houston": "US",          # NRG Stadium
    "Inglewood": "US",        # SoFi Stadium (Los Angeles)
    "Kansas City": "US",      # Arrowhead Stadium
    "Miami Gardens": "US",    # Hard Rock Stadium
    "Philadelphia": "US",     # Lincoln Financial Field
    "Santa Clara": "US",      # Levi's Stadium (SF Bay Area)
    "Seattle": "US",          # Lumen Field
    # Canada (2)
    "Toronto": "CA",          # BMO Field
    "Vancouver": "CA",        # BC Place
    # Mexico (3)
    "Guadalupe": "MX",        # Estadio BBVA (Monterrey)
    "Mexico City": "MX",      # Estadio Azteca
    "Zapopan": "MX",          # Estadio Akron (Guadalajara)
}

# football-data match_id -> venue municipality. Host group games only (9 rows);
# knockout host games get added here once drawn (the host_flags raise enforces it).
MANUAL_VENUE = {
    "537327": "Mexico City",  # Mexico v South Africa, 6/11 — opening match, Azteca
    "537333": "Toronto",      # Canada v Bosnia-Herzegovina, 6/12
    "537345": "Inglewood",    # United States v Paraguay, 6/12 local (6/13 UTC)
    "537336": "Vancouver",    # Canada v Qatar, 6/18
    "537330": "Zapopan",      # Mexico v South Korea, 6/18 local (6/19 UTC)
    "537348": "Seattle",      # United States v Australia, 6/19
    "537337": "Vancouver",    # Switzerland v CANADA (host listed away), 6/24
    "537331": "Mexico City",  # Czechia v MEXICO (host listed away), 6/24 local
    "537349": "Inglewood",    # Turkey v UNITED STATES (host listed away), 6/25 local
}


def host_flags(
    match_id: str, home_id: str, away_id: str, fd_venue: str | None = None
) -> tuple[bool, bool]:
    """(is_host_home, is_host_away) for one match. Non-host matches: (False, False)
    without needing a venue. Host matches: venue must resolve and be known (raise)."""
    if home_id not in HOST_TEAMS and away_id not in HOST_TEAMS:
        return False, False
    venue = fd_venue or MANUAL_VENUE.get(match_id)
    if venue is None:
        raise ValueError(
            f"host match {match_id} ({home_id} v {away_id}) has no venue — "
            f"add it to etl/venues.py MANUAL_VENUE (fail-loud, P6 TA1)"
        )
    country = STADIUM_COUNTRY.get(venue)
    if country is None:
        raise ValueError(
            f"unknown venue {venue!r} for match {match_id} — add to etl/venues.py STADIUM_COUNTRY"
        )
    return country == home_id, country == away_id
