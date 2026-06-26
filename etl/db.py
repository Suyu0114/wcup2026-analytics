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


def fetch_matches_to_predict(only_unsettled: bool = False) -> list[dict]:
    """Matches with both teams set (all stored rows qualify; knockout TBD aren't stored yet).

    If ``only_unsettled``, skip ``status='final'`` — P10 dc-v1.2 re-predicts only
    matches not yet settled (settled ones keep their frozen baseline prediction).
    """
    q = (
        get_client()
        .table("matches")
        .select("match_id,home_team,away_team,is_host_home,is_host_away")
    )
    if only_unsettled:
        q = q.neq("status", "final")
    return q.execute().data


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


# --- P6 A3 diagnosis reads (read-only) ---

def fetch_latest_pinnacle(market: str) -> dict:
    """{match_id: {(outcome, point): decimal_odds}} — latest stored price per series.

    Ordered by captured_at ascending so the dict overwrite leaves the newest price.
    Paginated (PostgREST ~1000-row cap)."""
    client = get_client()
    out: dict = {}
    start, page = 0, 1000
    while True:
        chunk = (
            client.table("odds_snapshots")
            .select("match_id,outcome,point,decimal_odds,captured_at")
            .eq("bookmaker", "pinnacle")
            .eq("market", market)
            .order("captured_at")
            .range(start, start + page - 1)
            .execute()
            .data
        )
        for r in chunk:
            pt = r.get("point")
            key = (r["outcome"], None if pt is None else float(pt))
            out.setdefault(r["match_id"], {})[key] = float(r["decimal_odds"])
        if len(chunk) < page:
            return out
        start += page


def fetch_model_total_lines_map(model_version: str) -> dict:
    """{(match_id, point): (model_p_over, model_p_under)}."""
    data = (
        get_client()
        .table("model_total_lines")
        .select("match_id,point,model_p_over,model_p_under")
        .eq("model_version", model_version)
        .execute()
        .data
    )
    return {
        (d["match_id"], float(d["point"])): (float(d["model_p_over"]), float(d["model_p_under"]))
        for d in data
    }


def fetch_matches_with_names() -> dict:
    """{match_id: 'HomeName v AwayName (kickoff date)'} for report readability."""
    teams = {t["team_id"]: t["name_en"] for t in fetch_teams()}
    out = {}
    for m in fetch_matches_for_mapping():
        out[m["match_id"]] = (
            f"{teams.get(m['home_team'], m['home_team'])} v "
            f"{teams.get(m['away_team'], m['away_team'])} ({m['kickoff_utc'][:10]})"
        )
    return out


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


def fetch_manual_results() -> dict[str, tuple[int, int]]:
    """{match_id: (home_goals, away_goals)} from manual_results (admin-entered overrides).

    Authoritative hand-verified scores; ingest_fixtures reads these DB-first (P7).
    """
    rows = (
        get_client()
        .table("manual_results")
        .select("match_id,home_goals,away_goals")
        .execute()
        .data
    )
    return {r["match_id"]: (int(r["home_goals"]), int(r["away_goals"])) for r in rows}


def upsert_manual_result(
    match_id: str,
    home_goals: int,
    away_goals: int,
    entered_by: str | None = None,
    note: str | None = None,
) -> None:
    """Upsert one curated result on match_id (idempotent). Source for matchday recompute."""
    row = {
        "match_id": match_id,
        "home_goals": home_goals,
        "away_goals": away_goals,
        "entered_by": entered_by,
        "note": note,
    }
    get_client().table("manual_results").upsert([row], on_conflict="match_id").execute()


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


def fetch_prediction_versions() -> list[str]:
    """All model_versions present in match_predictions (TA5: calibrate scores each)."""
    data = get_client().table("match_predictions").select("model_version").execute().data
    return sorted({d["model_version"] for d in data})


def insert_calibration_run(row: dict) -> None:
    """Append-only provenance log (P6 §3.5): one row per calibrate run per version."""
    get_client().table("calibration_runs").insert(row).execute()


def upsert_predictions(rows: list[dict]) -> int:
    get_client().table("match_predictions").upsert(
        rows, on_conflict="match_id,model_version"
    ).execute()
    return len(rows)


# --- P2 reads/writes (group-stage simulation) ---

def fetch_group_matches_with_predictions(model_version: str = "dc-v1.0") -> list[dict]:
    """Join matches (stage='group') with match_predictions to get lambda_home/away.

    Also includes status, home_goals, away_goals for settled match locking (D3).
    Validation: 72 group matches; UNSETTLED matches must have a prediction for this
    version. P10: dc-v1.2 only predicts unsettled matches, so SETTLED matches may lack
    a prediction here — that's allowed (D3 locks them to the real score and never reads
    lambda; a 0.0 placeholder is used). Settled matches must have non-null goals.
    """
    # Fetch group-stage matches
    matches = (
        get_client()
        .table("matches")
        .select("match_id,stage,group_label,home_team,away_team,status,home_goals,away_goals")
        .eq("stage", "group")
        .execute()
        .data
    )
    if len(matches) != 72:
        raise ValueError(
            f"Expected 72 group matches, got {len(matches)} (fail-loud)"
        )

    # Fetch predictions for these matches
    preds = (
        get_client()
        .table("match_predictions")
        .select("match_id,lambda_home,lambda_away")
        .eq("model_version", model_version)
        .execute()
        .data
    )
    pred_map = {p["match_id"]: p for p in preds}

    # Join + validate
    result = []
    for m in matches:
        mid = m["match_id"]
        pred = pred_map.get(mid)
        is_settled = m["status"] == "final"
        # P10: settled matches may lack a prediction for this version (dc-v1.2 only
        # predicts unsettled). Fail loud only when an UNSETTLED match has no prediction.
        if pred is None and not is_settled:
            raise ValueError(
                f"Match {mid} has no prediction for model {model_version} (fail-loud)"
            )
        # Settled match validation (verify-don't-assume)
        if is_settled:
            if m["home_goals"] is None or m["away_goals"] is None:
                raise ValueError(
                    f"Settled match {mid} (status='final') missing goals (verify-don't-assume)"
                )
        result.append({
            "match_id": mid,
            "group_label": m["group_label"],
            "home_team": m["home_team"],
            "away_team": m["away_team"],
            # settled + no prediction → 0.0 placeholder. D3 locks the score and never
            # reads lambda (engine/group_sim.py); 0.0 (not NaN) avoids silent numpy NaN.
            "lambda_home": float(pred["lambda_home"]) if pred else 0.0,
            "lambda_away": float(pred["lambda_away"]) if pred else 0.0,
            "is_settled": is_settled,
            "home_goals": int(m["home_goals"]) if m["home_goals"] is not None else None,
            "away_goals": int(m["away_goals"]) if m["away_goals"] is not None else None,
        })
    return result


def upsert_group_sim(rows: list[dict]) -> int:
    """Upsert to group_sim on_conflict=(team_id, model_version). Idempotent."""
    if rows:
        get_client().table("group_sim").upsert(
            rows, on_conflict="team_id,model_version"
        ).execute()
    return len(rows)


# --- P8 reads/writes (FIFA-style group standings) ---

def fetch_group_matches_for_standings() -> list[dict]:
    """Group-stage matches with status + actual goals (no predictions needed).

    Standings are a FACT, decoupled from the model: returns every stored group
    match so the table can show all teams (group membership is derived from
    fixtures, not teams.group_label). The caller counts only status='final'.
    """
    return (
        get_client()
        .table("matches")
        .select("match_id,group_label,home_team,away_team,status,home_goals,away_goals")
        .eq("stage", "group")
        .execute()
        .data
    )


def upsert_group_standings(rows: list[dict]) -> int:
    """Upsert to group_standings on_conflict=team_id. Idempotent."""
    if rows:
        get_client().table("group_standings").upsert(
            rows, on_conflict="team_id"
        ).execute()
    return len(rows)


# --- P11 reads/writes (qualification scenario analysis) ---

def replace_group_scenarios(rows: list[dict]) -> int:
    """Full delete-all + insert of group_scenarios (idempotent).

    Scenario rows are keyed by (match_id, outcome, team_id) and a match's rows
    DISAPPEAR once it goes final, so a plain upsert would leave stale rows. The
    table is tiny (≤432 rows) and fully recomputed each matchday → delete-all +
    insert is the cleanest idempotent pattern (spec §8.2). Reuses the P8 read
    fetch_group_matches_for_standings(); no new fetch needed.
    """
    client = get_client()
    # PostgREST requires a filter on delete; match a column present on every row.
    client.table("group_scenarios").delete().neq("match_id", "").execute()
    if rows:
        client.table("group_scenarios").insert(rows).execute()
    return len(rows)


# --- P14 reads/writes (full-tournament knockout Monte Carlo) ---

def upsert_knockout_sim(rows: list[dict]) -> int:
    """Upsert to knockout_sim on_conflict=(team_id, model_version). Idempotent."""
    if rows:
        get_client().table("knockout_sim").upsert(
            rows, on_conflict="team_id,model_version"
        ).execute()
    return len(rows)


def replace_bracket_slot_sim(model_version: str, rows: list[dict]) -> int:
    """Replace this version's bracket_slot_sim rows (delete-by-version + insert).

    Occupancy rows are per (match_no, side, team_id, model_version); a team that no
    longer reaches a slot would otherwise leave a stale row, so we clear this
    version's rows first (other versions untouched), then insert. Idempotent.
    """
    client = get_client()
    client.table("bracket_slot_sim").delete().eq("model_version", model_version).execute()
    if rows:
        client.table("bracket_slot_sim").insert(rows).execute()
    return len(rows)

