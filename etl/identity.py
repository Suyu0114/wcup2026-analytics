"""Identity mapping (spec §2.3 / §4.1b): cross-source team names -> canonical team_id.

Canonical team_id = eloratings country_code. Every non-Elo source name must
resolve through here; an unresolvable *named* team is a hard error (fail-loud,
verify-don't-assume), never a silent new team.

MANUAL_ALIASES were discovered empirically against live football-data + the Elo
CSV: 45/48 auto-match by normalized name; only these 3 differ. (Note the spec's
predicted cases — Türkiye, Côte d'Ivoire, Korea — actually auto-match; the real
mismatches are different. Re-verify if either source changes.)
"""
from __future__ import annotations

import re
import unicodedata

from sources.fixture_source import FdTeam
from sources.rating_source import Rating

# football-data display name -> Elo team_id, for names that don't normalize-match.
MANUAL_ALIASES: dict[str, str] = {
    "Bosnia-Herzegovina": "BA",
    "Cape Verde Islands": "CV",
    "Congo DR": "CD",
}


def normalize_name(s: str) -> str:
    """Lowercase, strip accents and non-alphanumerics: 'Côte d'Ivoire' -> 'cotedivoire'."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s.lower())


def build_alias_map(fd_teams: list[FdTeam], ratings: list[Rating]) -> dict[str, str]:
    """Map every football-data name AND tla -> canonical team_id.

    Raises if any team can't be resolved (so a new/renamed team is caught, not
    silently dropped).
    """
    elo_by_norm = {normalize_name(r.name_en): r.team_id for r in ratings}
    amap: dict[str, str] = {}
    unresolved: list[tuple[str | None, str]] = []
    for t in fd_teams:
        team_id = elo_by_norm.get(normalize_name(t.name)) or MANUAL_ALIASES.get(t.name)
        if not team_id:
            unresolved.append((t.tla, t.name))
            continue
        amap[t.name] = team_id
        if t.tla:
            amap[t.tla] = team_id
    if unresolved:
        raise ValueError(
            f"Unresolvable football-data teams (add to MANUAL_ALIASES): {unresolved}"
        )
    return amap


def resolve(alias_map: dict[str, str], tla: str | None, name: str | None) -> str:
    """tla first, then name (spec §4.2). Raise on a present-but-unknown team."""
    team_id = (alias_map.get(tla) if tla else None) or (alias_map.get(name) if name else None)
    if not team_id:
        raise ValueError(f"Unresolved team: tla={tla!r} name={name!r} (not in team_aliases)")
    return team_id
