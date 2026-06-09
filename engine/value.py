"""EV / value calculator — pure functions (P3, spec §5). No I/O, fully offline-testable.

⚠️ value uses the Pinnacle de-vig probability ONLY (spec decision #1 / TV4). Model
probability never enters this module — there is no model parameter anywhere here.
"""
from __future__ import annotations

KELLY_FRACTION_DEFAULT = 0.25


# --- odds format -> decimal (spec §5.6) ---
def to_decimal(value: float, fmt: str) -> float:
    f = fmt.lower()
    if f == "decimal":
        d = value
    elif f in ("hongkong", "hk"):
        d = value + 1.0
    elif f in ("american", "us", "moneyline"):
        d = 1.0 + (value / 100.0 if value > 0 else 100.0 / abs(value))
    elif f in ("indonesian", "indo"):
        d = (value + 1.0) if value > 0 else (1.0 + 1.0 / abs(value))
    elif f in ("malaysian", "malay"):
        d = (value + 1.0) if value > 0 else (1.0 + 1.0 / abs(value))
    else:
        raise ValueError(f"unknown odds format {fmt!r}")
    if d <= 1.0:
        raise ValueError(f"decimal odds must be > 1 (got {d})")
    return d


# --- de-vig: proportional normalization (spec §5.1) ---
def novig(prices: dict[str, float]) -> dict[str, float]:
    raw = {o: 1.0 / p for o, p in prices.items()}
    s = sum(raw.values())
    return {o: r / s for o, r in raw.items()}


# --- EV / value (spec §5.0) ---
def ev(p_novig: float, decimal_odds: float) -> float:
    return p_novig * decimal_odds - 1.0


def is_value(p_novig: float, decimal_odds: float) -> bool:
    return ev(p_novig, decimal_odds) > 0.0


# --- Kelly: fraction of bankroll (spec §5.3) ---
def kelly_fraction(p_novig: float, decimal_odds: float, fraction: float = KELLY_FRACTION_DEFAULT) -> float:
    f_star = (decimal_odds * p_novig - 1.0) / (decimal_odds - 1.0)
    return max(0.0, fraction * f_star)          # negative EV -> 0


# --- totals line helpers (spec §5.2) ---
def is_quarter_line(point: float) -> bool:
    """2.25 / 2.75 → True (half-push settlement → EV/Kelly approximate)."""
    return (2.0 * point) % 1.0 != 0.0


def totals_line_matches(user_point: float, pinnacle_main_point: float) -> bool:
    return user_point == pinnacle_main_point


# --- line-shopping best available — caller passes ONE outcome at ONE line (spec §5.5) ---
def best_available(prices_by_book: dict[str, float]) -> tuple[str, float]:
    book = max(prices_by_book, key=prices_by_book.get)
    return book, prices_by_book[book]


def evaluate(
    p_novig: float,
    user_value: float,
    user_format: str = "decimal",
    *,
    point: float | None = None,
    pinnacle_main_point: float | None = None,
    fraction: float = KELLY_FRACTION_DEFAULT,
) -> dict:
    """Frontend-facing result (spec §5). totals require the Pinnacle main line; mismatch
    => no EV/value. Quarter lines => 'approximate' flag. value uses p_novig only."""
    d = to_decimal(user_value, user_format)
    out: dict = {"decimal_odds": d, "implied_prob": 1.0 / d, "p_pinnacle_novig": p_novig}

    if point is not None and (pinnacle_main_point is None or not totals_line_matches(point, pinnacle_main_point)):
        out.update(line_mismatch=True, ev=None, value=None, kelly_fraction=None)
        return out

    e = ev(p_novig, d)
    out.update(
        line_mismatch=False,
        ev=e,
        value=e > 0.0,
        kelly_fraction=kelly_fraction(p_novig, d, fraction),
        approximate=(point is not None and is_quarter_line(point)),
    )
    return out
