"""Fixture sources (adapter pattern, spec §2.2).

v1 = FootballDataFixtureSource: football-data.org v4. Token read from env
(FOOTBALL_DATA_TOKEN) and sent as the `X-Auth-Token` header.

⚠️ Pre-tournament reality: the API returns all 104 matches, but the 32
knockout matches have null teams until the bracket is drawn. get_fixtures()
returns them with home/away = None; the ingest skips those until teams exist
(idempotent re-run fills them in). Group matches are fully populated.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import requests

from etl import config

# football-data stage enum -> internal value (spec §2.2).
STAGE_MAP = {
    "GROUP_STAGE": "group",
    "LAST_32": "r32",
    "LAST_16": "r16",
    "QUARTER_FINALS": "qf",
    "SEMI_FINALS": "sf",
    "THIRD_PLACE": "3rd",
    "FINAL": "final",
}

# football-data status -> internal (spec matches.status: scheduled|live|final).
STATUS_MAP = {
    "SCHEDULED": "scheduled",
    "TIMED": "scheduled",
    "IN_PLAY": "live",
    "PAUSED": "live",
    "FINISHED": "final",
}


@dataclass(frozen=True)
class FdTeam:
    tla: str | None         # 3-letter code, e.g. 'NED'
    name: str               # full name, e.g. 'Netherlands'


@dataclass(frozen=True)
class Fixture:
    match_id: str
    stage: str                      # internal: group|r32|r16|qf|sf|3rd|final
    group_label: str | None         # 'A'..'L' for group stage, else None
    home_tla: str | None            # None until knockout bracket is drawn
    home_name: str | None
    away_tla: str | None
    away_name: str | None
    kickoff_utc: str                # ISO-8601 UTC string
    status: str                     # internal: scheduled|live|final


def _group_letter(group: str | None) -> str | None:
    """'GROUP_F' -> 'F'; None -> None (knockout)."""
    if not group:
        return None
    return group.split("_")[-1]


class FixtureSource(Protocol):
    def get_fixtures(self) -> list[Fixture]: ...


class FootballDataFixtureSource:
    def __init__(self, token: str | None = None, base: str | None = None, season: int = 2026):
        self.token = token or config.football_data_token()
        self.base = base or config.FOOTBALL_DATA_BASE
        self.season = season

    def _get(self, path: str) -> dict:
        r = requests.get(
            f"{self.base}{path}",
            headers={"X-Auth-Token": self.token},
            timeout=30,
        )
        r.raise_for_status()
        return r.json()

    def get_teams(self) -> list[FdTeam]:
        data = self._get(f"/competitions/WC/teams?season={self.season}")
        return [FdTeam(tla=t.get("tla"), name=t["name"]) for t in data["teams"]]

    def get_fixtures(self) -> list[Fixture]:
        data = self._get(f"/competitions/WC/matches?season={self.season}")
        out: list[Fixture] = []
        for m in data["matches"]:
            stage = m["stage"]
            if stage not in STAGE_MAP:
                raise ValueError(f"Unknown stage {stage!r} for match {m['id']}")
            home = m.get("homeTeam") or {}
            away = m.get("awayTeam") or {}
            out.append(
                Fixture(
                    match_id=str(m["id"]),
                    stage=STAGE_MAP[stage],
                    group_label=_group_letter(m.get("group")),
                    home_tla=home.get("tla"),
                    home_name=home.get("name"),
                    away_tla=away.get("tla"),
                    away_name=away.get("name"),
                    kickoff_utc=m["utcDate"],
                    status=STATUS_MAP.get(m["status"], "scheduled"),
                )
            )
        return out
