"""TF5 — cross-source spot check (spec §6).

3 matches verified by hand against the FIFA official 2026 draw, asserted against
our INGESTED `matches` table. Catches a stale/wrong draw OR an ingestion bug: if
stored teams / kickoff / group disagree with the official, it fails.

Reads Supabase (resolving names via the seeded team_aliases), so it's stable and
doesn't burn the football-data rate limit. Skips cleanly if SUPABASE_* creds are
absent, keeping the offline suite green. Re-verify if the draw changes.
"""
from datetime import datetime

import pytest

# Verified against the FIFA official draw. home/away are display names, resolved
# through team_aliases so spelling differences don't matter.
EXPECTED: list[dict] = [
    {"match_id": "537327", "home": "Mexico",      "away": "South Africa", "kickoff_utc": "2026-06-11T19:00:00+00:00", "group_label": "A"},
    {"match_id": "537328", "home": "South Korea", "away": "Czechia",      "kickoff_utc": "2026-06-12T02:00:00+00:00", "group_label": "A"},
    {"match_id": "537352", "home": "Ivory Coast", "away": "Ecuador",      "kickoff_utc": "2026-06-14T23:00:00+00:00", "group_label": "E"},
]


def _instant(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def test_tf5_cross_source_spot_check():
    assert 3 <= len(EXPECTED) <= 5, "TF5: hardcode 3-5 matches confirmed from the official source"

    try:
        from etl import db
        client = db.get_client()
    except Exception as e:  # creds missing -> keep the offline suite green
        pytest.skip(f"TF5 needs Supabase creds: {e}")

    aliases = {
        r["alias"]: r["team_id"]
        for r in client.table("team_aliases").select("alias,team_id").execute().data
    }

    for m in EXPECTED:
        rows = (
            client.table("matches")
            .select("home_team,away_team,kickoff_utc,group_label")
            .eq("match_id", m["match_id"])
            .execute()
            .data
        )
        assert rows, f"TF5: match {m['match_id']} not in ingested matches"
        got = rows[0]
        assert got["home_team"] == aliases[m["home"]], f"TF5: home mismatch for {m['match_id']}"
        assert got["away_team"] == aliases[m["away"]], f"TF5: away mismatch for {m['match_id']}"
        assert _instant(got["kickoff_utc"]) == _instant(m["kickoff_utc"]), \
            f"TF5: kickoff mismatch for {m['match_id']}: {got['kickoff_utc']} != {m['kickoff_utc']}"
        assert got["group_label"] == m["group_label"], \
            f"TF5: group mismatch for {m['match_id']}: {got['group_label']} != {m['group_label']}"
