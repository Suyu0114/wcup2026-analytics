"""Environment + path config (spec §2). Fail loud on missing secrets."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()  # reads .env (git-ignored) if present; no-op in CI where vars are injected

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ELO_CSV = PROJECT_ROOT / "etl" / "data" / "raw" / "elo" / "elo_ratings_wc2026.csv"

FOOTBALL_DATA_BASE = "https://api.football-data.org/v4"


def _require(name: str) -> str:
    val = os.getenv(name)
    if not val:
        raise RuntimeError(
            f"Missing required env var {name!r}. Copy .env.example -> .env and fill it in."
        )
    return val


def football_data_token() -> str:
    """football-data.org token; sent as the `X-Auth-Token` request header."""
    return _require("FOOTBALL_DATA_TOKEN")


def supabase_url() -> str:
    return _require("SUPABASE_URL")


def supabase_service_key() -> str:
    return _require("SUPABASE_SERVICE_KEY")
