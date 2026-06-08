"""Team rating sources (adapter pattern, spec §2.1).

v1 = CsvRatingSource: reads the WC2026 Elo CSV and returns one canonical
record per team. The eloratings `country_code` IS the canonical team_id
(spec §1.2 / §2.1) — ratings never go through team_aliases.

Future adapters (EloRatingsTsvSource, ComputedEloSource) implement the same
RatingSource protocol so the rest of the pipeline is unchanged.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Protocol

import pandas as pd


@dataclass(frozen=True)
class Rating:
    team_id: str            # = eloratings country_code (canonical key, e.g. 'ES'/'KR'/'BR')
    name_en: str
    elo: float
    asof: date              # real snapshot date (provenance); never a future year-end
    confederation: str
    is_host: bool


class RatingSource(Protocol):
    def get_ratings(self) -> list[Rating]: ...


# Columns we depend on; absence => fail loud (verify-don't-assume).
_REQUIRED_COLS = {
    "country", "country_code", "rating", "snapshot_date", "confederation", "is_host",
}


class CsvRatingSource:
    """Reads the WC2026 Elo CSV (Kaggle, CC BY-SA 4.0).

    The file holds many yearly snapshots per team plus a live row, AND a
    future-dated year-end row (e.g. 2026-12-31) whose numbers are copied from
    the current live snapshot. A plain max(snapshot_date) would pick that future
    date — values right, provenance (as-of) fake. So: drop rows dated in the
    future, then keep the latest remaining snapshot per team (spec §4.1).
    """

    def __init__(self, csv_path: str | Path, today: date | None = None):
        self.csv_path = Path(csv_path)
        self.today = today or date.today()

    def get_ratings(self) -> list[Rating]:
        if not self.csv_path.exists():
            raise FileNotFoundError(f"Elo CSV not found: {self.csv_path}")
        df = pd.read_csv(self.csv_path)

        missing = _REQUIRED_COLS - set(df.columns)
        if missing:
            raise ValueError(f"Elo CSV missing required columns: {sorted(missing)}")

        df["snapshot_date"] = pd.to_datetime(df["snapshot_date"]).dt.date

        # (1) drop future-dated snapshots (fake provenance); (2) latest per team.
        df = df[df["snapshot_date"] <= self.today]
        if df.empty:
            raise ValueError(
                f"No Elo rows dated on/before {self.today}; check the CSV / today arg."
            )
        df = (
            df.sort_values("snapshot_date")
              .groupby("country_code", as_index=False)
              .tail(1)
        )

        return [
            Rating(
                team_id=str(r.country_code),
                name_en=str(r.country),
                elo=float(r.rating),
                asof=r.snapshot_date,
                confederation=str(r.confederation),
                is_host=bool(int(r.is_host)),
            )
            for r in df.itertuples(index=False)
        ]
