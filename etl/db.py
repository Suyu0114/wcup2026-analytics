"""Supabase (Postgres) load helpers. All writes are idempotent upserts (spec §4).

The Elo ingest owns only the rating columns of `teams`; upsert leaves curated
columns (name_zh, group_label) untouched on conflict.
"""
from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from etl import config
from sources.rating_source import Rating


@lru_cache(maxsize=1)
def get_client() -> Client:
    return create_client(config.supabase_url(), config.supabase_service_key())


def upsert_teams(ratings: list[Rating]) -> int:
    rows = [
        {
            "team_id": r.team_id,
            "name_en": r.name_en,
            "elo": r.elo,
            "elo_asof": r.asof.isoformat(),
            "confederation": r.confederation,
        }
        for r in ratings
    ]
    get_client().table("teams").upsert(rows, on_conflict="team_id").execute()
    return len(rows)


def upsert_aliases(alias_map: dict[str, str], source: str = "fixtures") -> int:
    rows = [{"alias": a, "team_id": tid, "source": source} for a, tid in alias_map.items()]
    get_client().table("team_aliases").upsert(rows, on_conflict="alias").execute()
    return len(rows)


def upsert_matches(rows: list[dict]) -> int:
    get_client().table("matches").upsert(rows, on_conflict="match_id").execute()
    return len(rows)


# --- reads (P1 prediction job) ---

def fetch_team_elos() -> dict[str, float]:
    rows = get_client().table("teams").select("team_id,elo").execute().data
    return {r["team_id"]: float(r["elo"]) for r in rows}


def fetch_matches_to_predict() -> list[dict]:
    """Matches with both teams set (all stored rows qualify; knockout TBD aren't stored yet)."""
    return (
        get_client()
        .table("matches")
        .select("match_id,home_team,away_team,is_host_home")
        .execute()
        .data
    )


def upsert_predictions(rows: list[dict]) -> int:
    get_client().table("match_predictions").upsert(
        rows, on_conflict="match_id,model_version"
    ).execute()
    return len(rows)
