"""The Odds API source (P3, spec §2). Key from env (ODDS_API_KEY), sent as `apiKey` param.

events endpoint is free (alias seeding); the odds endpoint costs 2 credits/call with
`bookmakers=` (≤10 books, any region) + `markets=h2h,totals` — no `regions=`.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import requests

from etl import config

ODDS_BASE = "https://api.the-odds-api.com/v4"
SPORT_KEY = "soccer_fifa_world_cup"


@dataclass(frozen=True)
class OddsOutcome:
    name: str                       # team name | 'Draw' | 'Over' | 'Under'
    price: float                    # decimal
    point: float | None = None      # totals only


@dataclass(frozen=True)
class OddsMarket:
    key: str                        # 'h2h' | 'totals'
    last_update: str                # ISO-8601 (per-market change time = dedup key)
    outcomes: list[OddsOutcome]


@dataclass(frozen=True)
class OddsBookmaker:
    key: str                        # 'pinnacle' | 'draftkings' | ...
    markets: list[OddsMarket]


@dataclass(frozen=True)
class OddsEvent:
    event_id: str
    home_team: str                  # The Odds API spelling (resolve via team_aliases)
    away_team: str
    commence_time: str              # ISO-8601 UTC
    bookmakers: list[OddsBookmaker] = field(default_factory=list)


class TheOddsApiSource:
    def __init__(self, api_key: str | None = None, base: str = ODDS_BASE, sport: str = SPORT_KEY):
        self.api_key = api_key or config.odds_api_key()
        self.base = base
        self.sport = sport

    def _get(self, path: str, params: dict):
        r = requests.get(f"{self.base}{path}", params={**params, "apiKey": self.api_key}, timeout=30)
        r.raise_for_status()
        return r

    def get_events(self) -> list[OddsEvent]:
        """Free endpoint (0 credits) — used for alias seeding."""
        data = self._get(f"/sports/{self.sport}/events", {}).json()
        return [OddsEvent(e["id"], e["home_team"], e["away_team"], e["commence_time"]) for e in data]

    def get_odds(self, bookmakers: list[str], markets: list[str]) -> list[OddsEvent]:
        """2 credits/call. Returns events with nested bookmakers/markets/outcomes."""
        data = self._get(
            f"/sports/{self.sport}/odds",
            {"bookmakers": ",".join(bookmakers), "markets": ",".join(markets), "oddsFormat": "decimal"},
        ).json()
        out: list[OddsEvent] = []
        for e in data:
            bks = [
                OddsBookmaker(
                    key=bk["key"],
                    markets=[
                        OddsMarket(
                            key=mk["key"],
                            last_update=mk["last_update"],
                            outcomes=[OddsOutcome(o["name"], float(o["price"]), o.get("point")) for o in mk["outcomes"]],
                        )
                        for mk in bk.get("markets", [])
                    ],
                )
                for bk in e.get("bookmakers", [])
            ]
            out.append(OddsEvent(e["id"], e["home_team"], e["away_team"], e["commence_time"], bks))
        return out
