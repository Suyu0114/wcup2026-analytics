"""Seed curated zh-TW team names into teams.name_zh.

Curated lookup (繁體中文 / Taiwan usage) — **NOT** machine translation (P0-P1 spec §3 i18n
note / CLAUDE.md). Idempotent: updates name_zh by team_id, safe to re-run. Fail-loud if the DB
has a team_id with no curated name (verify-don't-assume — every team must be covered).

    python -m etl.seed_team_names_zh [--dry-run]

team_id = eloratings country_code (two-letter). Two codes are non-ISO: EN=England, SQ=Scotland.
"""
from __future__ import annotations

import argparse

# team_id -> zh-TW (繁體, 台灣慣用譯名)
NAMES_ZH: dict[str, str] = {
    "AR": "阿根廷",
    "AT": "奧地利",
    "AU": "澳洲",
    "BA": "波士尼亞與赫塞哥維納",
    "BE": "比利時",
    "BR": "巴西",
    "CA": "加拿大",
    "CD": "剛果民主共和國",
    "CH": "瑞士",
    "CI": "象牙海岸",
    "CO": "哥倫比亞",
    "CV": "維德角",
    "CW": "庫拉索",
    "CZ": "捷克",
    "DE": "德國",
    "DZ": "阿爾及利亞",
    "EC": "厄瓜多",
    "EG": "埃及",
    "EN": "英格蘭",
    "ES": "西班牙",
    "FR": "法國",
    "GH": "迦納",
    "HR": "克羅埃西亞",
    "HT": "海地",
    "IQ": "伊拉克",
    "IR": "伊朗",
    "JO": "約旦",
    "JP": "日本",
    "KR": "南韓",
    "MA": "摩洛哥",
    "MX": "墨西哥",
    "NL": "荷蘭",
    "NO": "挪威",
    "NZ": "紐西蘭",
    "PA": "巴拿馬",
    "PT": "葡萄牙",
    "PY": "巴拉圭",
    "QA": "卡達",
    "SA": "沙烏地阿拉伯",
    "SE": "瑞典",
    "SN": "塞內加爾",
    "SQ": "蘇格蘭",
    "TN": "突尼西亞",
    "TR": "土耳其",
    "US": "美國",
    "UY": "烏拉圭",
    "UZ": "烏茲別克",
    "ZA": "南非",
}


def run(dry_run: bool = False) -> None:
    from etl.db import get_client

    client = get_client()
    rows = client.table("teams").select("team_id,name_en,name_zh").execute().data

    # verify-don't-assume: every team in the DB must have a curated name
    missing = sorted(r["team_id"] for r in rows if r["team_id"] not in NAMES_ZH)
    if missing:
        raise ValueError(f"No curated zh-TW name for team_id(s): {missing} (fail-loud)")

    print(f"{len(rows)} teams in DB; {len(NAMES_ZH)} curated names")
    if dry_run:
        for r in sorted(rows, key=lambda x: x["team_id"]):
            print(f"  {r['team_id']}  {r['name_en']:26} -> {NAMES_ZH[r['team_id']]}")
        print("dry-run: no writes")
        return

    n = 0
    for r in rows:
        zh = NAMES_ZH[r["team_id"]]
        if r.get("name_zh") == zh:
            continue  # already set (idempotent)
        client.table("teams").update({"name_zh": zh}).eq("team_id", r["team_id"]).execute()
        n += 1
    print(f"updated name_zh for {n} teams ({len(rows) - n} already current)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    run(dry_run=args.dry_run)
