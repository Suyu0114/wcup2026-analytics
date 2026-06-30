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

from datetime import datetime, timedelta, timezone

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
    # Knockout host games (added post-draw 2026-06-28; the host_flags raise forces
    # this). Venue is fixed by the FIFA match-number SLOT, not by who qualifies, so a
    # host can draw a neutral venue. match_no/venue from the official R32 schedule,
    # cross-checked against the bracket.py slot pairing + the fd kickoff/teams.
    "537417": "Inglewood",    # R32 m73 (2A v 2B): South Africa v CANADA, SoFi — host NEUTRAL (US venue)
    "537425": "Mexico City",  # R32 m79 (1A v 3rd): MEXICO v Ecuador, Azteca — host home
    "537421": "Santa Clara",  # R32 m81 (1D v 3rd): UNITED STATES v Bosnia-Herzegovina, Levi's — host home
}

# Official FIFA 2026 knockout schedule, keyed by scheduled UTC kick-off -> venue.
# The venue of each knockout match is fixed by its FIFA match-number SLOT, not by who
# qualifies, so it is knowable before the draw. football-data echoes the same kick-off,
# letting host_flags resolve any knockout host venue (incl. R16→Final, as hosts advance)
# without curating an fd match_id per match (the MANUAL_VENUE rows above stay as explicit
# overrides + provenance and take precedence). A host match whose kick-off matches no slot
# still raises (fail-loud) so a real schedule change can't pass silently.
#
# Provenance (curated 2026-06-28): en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage
# (slot venues + local kick-offs) and the FIFA/NY-NJ schedule for the final (3 p.m. EDT).
# Local kick-offs → UTC with venue time zones: EDT/Toronto UTC−4, CDT UTC−5, PDT/Vancouver
# UTC−7, Mexico CST UTC−6 (no DST). Match numbers (73–104, FIFA's) given for provenance only.
KNOCKOUT_VENUE_BY_KICKOFF: dict[str, str] = {
    # Round of 32 (m73–m88)
    "2026-06-28T19:00:00+00:00": "Inglewood",       # m73
    "2026-06-29T17:00:00+00:00": "Houston",         # m76
    "2026-06-29T20:30:00+00:00": "Foxborough",      # m74
    "2026-06-30T01:00:00+00:00": "Guadalupe",       # m75
    "2026-06-30T17:00:00+00:00": "Arlington",       # m78
    "2026-06-30T21:00:00+00:00": "East Rutherford", # m77
    "2026-07-01T01:00:00+00:00": "Mexico City",     # m79
    "2026-07-01T16:00:00+00:00": "Atlanta",         # m80
    "2026-07-01T20:00:00+00:00": "Seattle",         # m82
    "2026-07-02T00:00:00+00:00": "Santa Clara",     # m81
    "2026-07-02T19:00:00+00:00": "Inglewood",       # m84
    "2026-07-02T23:00:00+00:00": "Toronto",         # m83
    "2026-07-03T03:00:00+00:00": "Vancouver",       # m85
    "2026-07-03T18:00:00+00:00": "Arlington",       # m88
    "2026-07-03T22:00:00+00:00": "Miami Gardens",   # m86
    "2026-07-04T01:30:00+00:00": "Kansas City",     # m87
    # Round of 16 (m89–m96)
    "2026-07-04T17:00:00+00:00": "Houston",         # m90
    "2026-07-04T21:00:00+00:00": "Philadelphia",    # m89
    "2026-07-05T20:00:00+00:00": "East Rutherford", # m91
    "2026-07-06T00:00:00+00:00": "Mexico City",     # m92
    "2026-07-06T19:00:00+00:00": "Arlington",       # m93
    "2026-07-07T00:00:00+00:00": "Seattle",         # m94
    "2026-07-07T16:00:00+00:00": "Atlanta",         # m95
    "2026-07-07T20:00:00+00:00": "Vancouver",       # m96
    # Quarter-finals (m97–m100)
    "2026-07-09T20:00:00+00:00": "Foxborough",      # m97
    "2026-07-10T19:00:00+00:00": "Inglewood",       # m98
    "2026-07-11T21:00:00+00:00": "Miami Gardens",   # m99
    "2026-07-12T01:00:00+00:00": "Kansas City",     # m100
    # Semi-finals (m101–m102)
    "2026-07-14T19:00:00+00:00": "Arlington",       # m101
    "2026-07-15T19:00:00+00:00": "Atlanta",         # m102
    # Third-place play-off (m103) + Final (m104)
    "2026-07-18T21:00:00+00:00": "Miami Gardens",   # m103
    "2026-07-19T19:00:00+00:00": "East Rutherford", # m104
}

# A knockout match resolves to the curated slot whose kick-off is within this window.
# Slots are ≥3.5 h apart, so this is unambiguous while absorbing minor fd kick-off drift.
SCHEDULE_MATCH_WINDOW = timedelta(minutes=75)


def _parse_utc(ts: str) -> datetime:
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


_SCHEDULE = [(_parse_utc(ts), venue) for ts, venue in KNOCKOUT_VENUE_BY_KICKOFF.items()]

# Import-time guards (fail-loud on a curation slip): all venues known, 32 slots, and no two
# kick-offs so close that the nearest-slot resolution would be ambiguous.
for _venue in KNOCKOUT_VENUE_BY_KICKOFF.values():
    if _venue not in STADIUM_COUNTRY:
        raise ValueError(f"knockout schedule venue {_venue!r} not in STADIUM_COUNTRY")
if len(KNOCKOUT_VENUE_BY_KICKOFF) != 32:
    raise ValueError(f"knockout schedule has {len(KNOCKOUT_VENUE_BY_KICKOFF)} slots, expected 32")
_times = sorted(dt for dt, _ in _SCHEDULE)
for _a, _b in zip(_times, _times[1:]):
    if _b - _a < 2 * SCHEDULE_MATCH_WINDOW:
        raise ValueError(f"knockout kick-offs {_a} and {_b} too close — slot key ambiguous")


def _schedule_venue(kickoff_utc: str | None) -> str | None:
    """Nearest scheduled knockout slot (within the window) -> its curated venue, else None."""
    if not kickoff_utc:
        return None
    try:
        ko = _parse_utc(kickoff_utc)
    except ValueError:
        return None
    best, best_delta = None, None
    for sched_dt, venue in _SCHEDULE:
        delta = abs(sched_dt - ko)
        if delta <= SCHEDULE_MATCH_WINDOW and (best_delta is None or delta < best_delta):
            best, best_delta = venue, delta
    return best


def host_flags(
    match_id: str,
    home_id: str,
    away_id: str,
    fd_venue: str | None = None,
    kickoff_utc: str | None = None,
) -> tuple[bool, bool]:
    """(is_host_home, is_host_away) for one match. Non-host matches: (False, False)
    without needing a venue. Host matches: venue must resolve and be known (raise).

    Resolution order: fd venue (none for WC2026) → curated MANUAL_VENUE (explicit override)
    → the FIFA knockout slot schedule by kick-off (covers any host knockout match)."""
    if home_id not in HOST_TEAMS and away_id not in HOST_TEAMS:
        return False, False
    venue = fd_venue or MANUAL_VENUE.get(match_id) or _schedule_venue(kickoff_utc)
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
