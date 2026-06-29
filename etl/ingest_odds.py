"""Odds ingest (P3, spec §4.1): The Odds API -> odds_snapshots (+ model_total_lines).

1 call (2 credits). event -> match_id by unordered team pair (group stage unique);
commence_time only soft-confirms. Outcomes oriented to our home/away. Stores a row
only when odds actually changed (dedup on last_update). Then triggers §4.4 recompute.

    python -m etl.ingest_odds             # ingest + model_total_lines to Supabase
    python -m etl.ingest_odds --dry-run   # fetch + map + coverage report, no DB write
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone

from etl import db, model_lines
from sources.odds_source import TheOddsApiSource

# Final list (≤10; pinnacle = sole sharp de-vig baseline; mixed eu/us via bookmakers=).
BOOKMAKERS = ["pinnacle", "draftkings", "fanduel", "betmgm", "bet365", "unibet", "williamhill", "betfair"]
MARKETS = ["h2h", "totals"]
SOFT_WINDOW = timedelta(hours=6)        # kickoff vs commence_time drift -> warn, not fail
GROUP_MATCHES = 72


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def build_pair_index(matches: list[dict]) -> dict[frozenset, list[dict]]:
    """{home,away} -> [match, ...]. A pair can recur once the knockout stage starts (group
    meeting + knockout rematch), so candidates are kept as a list and disambiguated by
    kick-off time at lookup (pick_match), per spec §9 A's "needs time/round disambiguation"."""
    idx: dict[frozenset, list[dict]] = {}
    for m in matches:
        idx.setdefault(frozenset((m["home_team"], m["away_team"])), []).append(m)
    return idx


def pick_match(candidates: list[dict], commence_time: str) -> dict | None:
    """The candidate whose kick-off is nearest the odds event's commence_time (rematch-safe).

    Group stage each pair has one candidate, so this is the identity; for a knockout rematch
    the live odds event sits next to the knockout fixture, not the long-settled group game.
    """
    if not candidates:
        return None
    ct = _parse(commence_time)
    return min(candidates, key=lambda m: abs((_parse(m["kickoff_utc"]) - ct).total_seconds()))


def map_outcome(market_key: str, name: str, point, match: dict, alias: dict[str, str]):
    """The Odds API outcome -> (internal outcome, point), oriented to our home/away (spec §2.1)."""
    if market_key == "h2h":
        if name == "Draw":
            return "draw", None
        tid = alias.get(name)
        if tid == match["home_team"]:
            return "home", None
        if tid == match["away_team"]:
            return "away", None
        raise ValueError(f"h2h outcome {name!r} -> {tid}, not in match {match['match_id']}")
    if market_key == "totals":
        side = {"Over": "over", "Under": "under"}.get(name)
        if side is None:
            raise ValueError(f"unknown totals outcome {name!r}")
        return side, point
    raise ValueError(f"unknown market {market_key!r}")


def pinnacle_main_point(ev, alias, match) -> float | None:
    """Pinnacle's totals main line; if multiple, the most balanced (min |1/over−1/under|)."""
    for bk in ev.bookmakers:
        if bk.key != "pinnacle":
            continue
        for mk in bk.markets:
            if mk.key != "totals":
                continue
            by_point: dict[float, dict[str, float]] = {}
            for oc in mk.outcomes:
                by_point.setdefault(oc.point, {})[oc.name] = oc.price
            best, best_bal = None, None
            for pt, sides in by_point.items():
                if "Over" in sides and "Under" in sides:
                    bal = abs(1.0 / sides["Over"] - 1.0 / sides["Under"])
                    if best is None or bal < best_bal:
                        best, best_bal = pt, bal
            return best
    return None


def run(dry_run: bool = False) -> list[dict]:
    src = TheOddsApiSource()
    events = src.get_odds(BOOKMAKERS, MARKETS)               # 1 call, 2 credits
    pair_index = build_pair_index(db.fetch_matches_for_mapping())
    alias = {a["alias"]: a["team_id"] for a in db.fetch_aliases()}
    batch_ts = datetime.now(timezone.utc).isoformat()

    rows: list[dict] = []
    skipped = 0
    h2h_cov, totals_cov, main_lines = set(), set(), {}
    for ev in events:
        a_id, b_id = alias.get(ev.home_team), alias.get(ev.away_team)
        if not a_id or not b_id:
            raise ValueError(f"odds event unresolved: {ev.home_team!r}/{ev.away_team!r} (run ingest_odds_aliases)")
        m = pick_match(pair_index.get(frozenset((a_id, b_id)), []), ev.commence_time)
        if m is None:
            skipped += 1                                     # not in our matches (e.g. not group) -> graceful
            continue
        if abs((_parse(ev.commence_time) - _parse(m["kickoff_utc"])).total_seconds()) > SOFT_WINDOW.total_seconds():
            print(f"  WARN kickoff drift {m['match_id']}: odds {ev.commence_time} vs match {m['kickoff_utc']}")
        mp = pinnacle_main_point(ev, alias, m)
        if mp is not None:
            main_lines[m["match_id"]] = mp
        for bk in ev.bookmakers:
            for mk in bk.markets:
                for oc in mk.outcomes:
                    outcome, point = map_outcome(mk.key, oc.name, oc.point, m, alias)
                    rows.append({
                        "match_id": m["match_id"], "bookmaker": bk.key, "market": mk.key,
                        "outcome": outcome, "point": point, "decimal_odds": oc.price,
                        "last_update": mk.last_update, "captured_at": batch_ts,
                    })
                    if bk.key == "pinnacle" and mk.key == "h2h":
                        h2h_cov.add(m["match_id"])
                    if bk.key == "pinnacle" and mk.key == "totals":
                        totals_cov.add(m["match_id"])

    print(f"Odds ingest: {len(rows)} rows from {len(events) - skipped} mapped events ({skipped} skipped).")
    print(f"  Pinnacle coverage (TO1): h2h {len(h2h_cov)}/{GROUP_MATCHES}, totals {len(totals_cov)}/{GROUP_MATCHES}.")

    if dry_run:
        print("--dry-run: skipping odds_snapshots insert + model_total_lines.")
        return rows

    ins, skip = db.insert_odds_snapshots_dedup(rows)
    print(f"odds_snapshots: inserted {ins}, skipped {skip} (unchanged).")
    model_lines.recompute(main_lines)
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description="Odds ingest (The Odds API -> odds_snapshots)")
    ap.add_argument("--dry-run", action="store_true", help="fetch + map + coverage, no DB write")
    args = ap.parse_args()
    run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
