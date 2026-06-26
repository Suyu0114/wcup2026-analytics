"""Scrape + validate FIFA 2026 Annex C → engine/data/annex_c.json (P14).

Annex C maps each of the C(12,8)=495 combinations of the eight qualifying
third-placed teams to which group winner each third faces in the Round of 32.
It is NOT derivable from the candidate sets (every combination admits 3–214
legal matchings; FIFA's choice is a specific published table), so it must be
sourced. We scrape the Wikipedia reproduction and validate it hard — including
a cross-check against engine/bracket.py's own candidate sets — before trusting
it (verify-don't-assume / data integrity over approximation).

Source: https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage
        table "Combinations of matches in the round of 32" (495 rows).
Scraped 2026-06-24. Re-run to refresh:  python engine/data/gen_annex_c.py
(needs requests + lxml; run from repo root so engine.bracket imports).

Output: engine/data/annex_c.json  — { "<8 sorted qualifying groups>": { "1A": "3E", ... }, ... }
"""
from __future__ import annotations

import io
import json
import os
import re

import pandas as pd
import requests

from engine.bracket import GROUPS, KO_MATCHES, THIRD_PLACE_SLOTS

URL = "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage"
GROUP_SET = set(GROUPS)
CELL_RE = re.compile(r"^3([A-L])$")

# --- the 8 winner-vs-third slots, as labels "1X", from the verified bracket ---
# (each third-place match's HOME slot is the group winner; AWAY is the third.)
SLOT_CANDIDATES: dict[str, frozenset[str]] = {}
for _mno, _cands in THIRD_PLACE_SLOTS.items():
    _home = KO_MATCHES[_mno]["home"]
    assert _home["type"] == "winner", f"M{_mno} home slot is not a winner (bracket drift)"
    SLOT_CANDIDATES[f"1{_home['group']}"] = _cands
EXPECTED_SLOTS = set(SLOT_CANDIDATES)  # {1A,1B,1D,1E,1G,1I,1K,1L}


def _fetch_table() -> pd.DataFrame:
    html = requests.get(URL, headers={"User-Agent": "wc2026-analytics/1.0 (research)"}, timeout=30).text
    tables = pd.read_html(io.StringIO(html))
    cands = [t for t in tables if t.shape[0] == 495]
    if len(cands) != 1:
        raise ValueError(f"expected exactly one 495-row table, found {len(cands)} (page layout changed?)")
    return cands[0]


def build() -> dict[str, dict[str, str]]:
    df = _fetch_table()
    group_cols = [c for c in df.columns if str(c).startswith("Third-placed teams advance from groups")]
    slot_cols = [c for c in df.columns if str(c).endswith(" vs")]
    if len(group_cols) != 12:
        raise ValueError(f"expected 12 group columns, found {len(group_cols)}")
    if {str(c).replace(" vs", "").strip() for c in slot_cols} != EXPECTED_SLOTS:
        raise ValueError(f"slot columns {slot_cols} != bracket slots {sorted(EXPECTED_SLOTS)}")

    out: dict[str, dict[str, str]] = {}
    for _, row in df.iterrows():
        # qualifying groups = the non-NaN group cells (the cell value IS the letter)
        quals = sorted(str(row[c]).strip() for c in group_cols if pd.notna(row[c]))
        if len(quals) != 8 or len(set(quals)) != 8 or not set(quals) <= GROUP_SET:
            raise ValueError(f"row {row.iloc[0]}: bad qualifying groups {quals}")

        assignment: dict[str, str] = {}
        for c in slot_cols:
            slot = str(c).replace(" vs", "").strip()
            cell = str(row[c]).strip()
            m = CELL_RE.match(cell)
            if not m:
                raise ValueError(f"row {row.iloc[0]} slot {slot}: bad cell {cell!r}")
            third_group = m.group(1)
            # 1) the assigned third must come from a qualifying group
            if third_group not in quals:
                raise ValueError(f"row {row.iloc[0]} {slot}->{cell}: {third_group} not in qualifiers {quals}")
            # 2) cross-check against the bracket candidate set (ties Annex C to engine/bracket.py)
            if third_group not in SLOT_CANDIDATES[slot]:
                raise ValueError(
                    f"row {row.iloc[0]} {slot}->{cell}: {third_group} not in candidate set "
                    f"{sorted(SLOT_CANDIDATES[slot])}"
                )
            # 3) no same-group pairing (1X never faces 3X)
            if slot == f"1{third_group}":
                raise ValueError(f"row {row.iloc[0]}: same-group pairing {slot}->{cell}")
            assignment[slot] = cell

        # bijection: the 8 assigned thirds are exactly the 8 qualifying groups
        assigned_groups = sorted(v[1] for v in assignment.values())
        if assigned_groups != quals:
            raise ValueError(f"row {row.iloc[0]}: assigned {assigned_groups} != qualifiers {quals}")
        if set(assignment) != EXPECTED_SLOTS:
            raise ValueError(f"row {row.iloc[0]}: slots {set(assignment)} != {EXPECTED_SLOTS}")

        key = "".join(quals)
        if key in out:
            raise ValueError(f"duplicate combination {key}")
        out[key] = assignment

    if len(out) != 495:
        raise ValueError(f"expected 495 unique combinations, got {len(out)}")
    return dict(sorted(out.items()))


def main() -> None:
    table = build()
    path = os.path.join(os.path.dirname(__file__), "annex_c.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(table, fh, indent=2)
        fh.write("\n")
    print(f"wrote {path}: {len(table)} combinations, all validators passed.")


if __name__ == "__main__":
    main()
