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


def fetch_teams() -> list[dict]:
    return get_client().table("teams").select("team_id,name_en").execute().data


def fetch_aliases() -> list[dict]:
    return get_client().table("team_aliases").select("alias,team_id").execute().data


def fetch_matches_for_mapping() -> list[dict]:
    return (
        get_client()
        .table("matches")
        .select("match_id,home_team,away_team,kickoff_utc")
        .execute()
        .data
    )


def _price_key(r: dict):
    """Identity of one price series: (match, book, market, outcome, point).

    NOT last_update — The Odds API ticks last_update even when the price is unchanged
    (verified 2026-06-09), so 'store on change' must compare the actual decimal_odds.
    """
    p = r.get("point")
    p = -1.0 if p is None else float(p)
    return (r["match_id"], r["bookmaker"], r["market"], r["outcome"], p)


def _fetch_all_odds_for(match_ids: list[str], page: int = 1000) -> list[dict]:
    """Paginated fetch (PostgREST caps a single response at ~1000 rows)."""
    client = get_client()
    out: list[dict] = []
    start = 0
    while True:
        chunk = (
            client.table("odds_snapshots")
            .select("match_id,bookmaker,market,outcome,point,decimal_odds,captured_at")
            .in_("match_id", match_ids)
            .order("captured_at")                  # asc -> last seen per key = latest
            .range(start, start + page - 1)
            .execute()
            .data
        )
        out.extend(chunk)
        if len(chunk) < page:
            return out
        start += page


def insert_odds_snapshots_dedup(rows: list[dict]) -> tuple[int, int]:
    """Store-on-change (spec §4.1): insert a row only when the price changed vs the latest
    stored price for that (match, book, market, outcome, point). Idempotent — re-running
    unchanged odds inserts nothing. Returns (inserted, skipped)."""
    if not rows:
        return 0, 0
    match_ids = sorted({r["match_id"] for r in rows})
    latest: dict = {}
    for d in _fetch_all_odds_for(match_ids):
        latest[_price_key(d)] = float(d["decimal_odds"])
    deduped: list[dict] = []
    seen: dict = {}
    for r in rows:
        k = _price_key(r)
        cur = float(r["decimal_odds"])
        prev = seen.get(k, latest.get(k))
        if prev is not None and abs(prev - cur) < 1e-9:
            continue                               # unchanged price -> skip
        seen[k] = cur
        deduped.append(r)
    if deduped:
        get_client().table("odds_snapshots").insert(deduped).execute()
    return len(deduped), len(rows) - len(deduped)


def fetch_match_lambdas(model_version: str) -> dict:
    data = (
        get_client()
        .table("match_predictions")
        .select("match_id,lambda_home,lambda_away")
        .eq("model_version", model_version)
        .execute()
        .data
    )
    return {d["match_id"]: (float(d["lambda_home"]), float(d["lambda_away"])) for d in data}


def upsert_model_total_lines(rows: list[dict]) -> int:
    if rows:
        get_client().table("model_total_lines").upsert(
            rows, on_conflict="match_id,point,model_version"
        ).execute()
    return len(rows)


# --- calibration reads (P3 §6) ---

def fetch_settled_matches() -> list[dict]:
    return (
        get_client()
        .table("matches")
        .select("match_id,home_goals,away_goals")
        .eq("status", "final")
        .execute()
        .data
    )


def fetch_match_predictions_1x2(model_version: str) -> dict:
    data = (
        get_client()
        .table("match_predictions")
        .select("match_id,p_home,p_draw,p_away")
        .eq("model_version", model_version)
        .execute()
        .data
    )
    return {
        d["match_id"]: {"home": float(d["p_home"]), "draw": float(d["p_draw"]), "away": float(d["p_away"])}
        for d in data
    }


def fetch_pinnacle_closing_h2h() -> dict:
    """{match_id: {outcome: decimal_odds}} from the closing view (Pinnacle h2h)."""
    data = (
        get_client()
        .table("odds_closing")
        .select("match_id,outcome,decimal_odds")
        .eq("bookmaker", "pinnacle")
        .eq("market", "h2h")
        .execute()
        .data
    )
    out: dict = {}
    for d in data:
        out.setdefault(d["match_id"], {})[d["outcome"]] = float(d["decimal_odds"])
    return out


def upsert_predictions(rows: list[dict]) -> int:
    get_client().table("match_predictions").upsert(
        rows, on_conflict="match_id,model_version"
    ).execute()
    return len(rows)
