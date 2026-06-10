"""EV / value calculator — pure functions (P3 spec §5 + P6 spec §3.4). No I/O.

Source-agnostic arithmetic: every function takes a probability from the CALLER
(market de-vig in market mode, model probability in model mode — P6 §1.7). This
module still imports no model and no market data, and contains no novig.
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


# --- totals line helpers (spec §5.2; approximate rule amended by P6 §3.4 / TB7) ---
def is_quarter_line(point: float) -> bool:
    """2.25 / 2.75 → True (half-stake split settlement)."""
    return (2.0 * point) % 1.0 != 0.0


def is_half_line(point: float) -> bool:
    """2.5 / 3.5 → True. Only half lines carry no push risk — in MARKET mode they
    are the only exact EV (integer lines push, quarters split; P6 TB7)."""
    return (2.0 * point) % 2.0 == 1.0


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
        # P6 TB7: two-way de-vig carries no push information, so only half lines are
        # exact — integer lines were always approximate too, now honestly flagged.
        approximate=(point is not None and not is_half_line(point)),
    )
    return out


# --- push-aware arithmetic for the MODEL totals mode (P6 spec §3.4) ---
# The model's score matrix knows P(total == L) exactly, so integer and quarter
# lines get exact EV here (unlike market mode).

def ev_with_push(p_win: float, p_push: float, decimal_odds: float) -> float:
    """Exact single-line EV with push risk: win → d−1, push → 0, lose → −1."""
    return p_win * decimal_odds - (1.0 - p_push)


def kelly_with_push(
    p_win: float, p_push: float, decimal_odds: float, fraction: float = KELLY_FRACTION_DEFAULT
) -> float:
    """Kelly with a push outcome. The E[log] first-order condition reduces to the
    binary Kelly on the push-conditioned probability — no extra scaling (P6 §3.4)."""
    p_lose = max(1.0 - p_win - p_push, 0.0)
    if p_win + p_lose <= 0.0:
        return 0.0
    p_eff = p_win / (p_win + p_lose)
    f_star = (decimal_odds * p_eff - 1.0) / (decimal_odds - 1.0)
    return max(0.0, fraction * f_star)


def quarter_components(point: float) -> tuple[float, float]:
    """Quarter line = half stake on each neighbouring line: x.25 → (x.0, x.5)."""
    if not is_quarter_line(point):
        raise ValueError(f"not a quarter line: {point}")
    return point - 0.25, point + 0.25


def evaluate_model_totals(
    p_win: float,
    p_push: float,
    user_value: float,
    user_format: str = "decimal",
    *,
    fraction: float = KELLY_FRACTION_DEFAULT,
) -> dict:
    """Model-mode totals at one (non-quarter) grid line — push-aware, exact."""
    d = to_decimal(user_value, user_format)
    e = ev_with_push(p_win, p_push, d)
    return {
        "decimal_odds": d,
        "ev": e,
        "value": e > 0.0,
        "kelly_fraction": kelly_with_push(p_win, p_push, d, fraction),
        "kelly_approximate": False,
    }


def evaluate_model_totals_quarter(
    lo: tuple[float, float],
    hi: tuple[float, float],
    user_value: float,
    user_format: str = "decimal",
    *,
    fraction: float = KELLY_FRACTION_DEFAULT,
) -> dict:
    """Model-mode quarter line: lo/hi = (p_win, p_push) at the two component lines.
    EV is exact (half stake each); Kelly = equal-weight average of the component
    f* — approximate, flagged (P6 §3.4 / TB7)."""
    d = to_decimal(user_value, user_format)
    e = 0.5 * ev_with_push(lo[0], lo[1], d) + 0.5 * ev_with_push(hi[0], hi[1], d)
    k = 0.5 * kelly_with_push(lo[0], lo[1], d, fraction) + 0.5 * kelly_with_push(hi[0], hi[1], d, fraction)
    return {
        "decimal_odds": d,
        "ev": e,
        "value": e > 0.0,
        "kelly_fraction": k,
        "kelly_approximate": True,
    }
