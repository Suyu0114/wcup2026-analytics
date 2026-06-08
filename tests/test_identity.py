"""Identity mapping unit tests (spec §2.3 / §4.1b) — pure, offline."""
import pytest

from etl.identity import build_alias_map, normalize_name, resolve
from sources.fixture_source import FdTeam
from sources.rating_source import Rating
from datetime import date


def _rating(team_id, name_en):
    return Rating(team_id=team_id, name_en=name_en, elo=1500.0,
                  asof=date(2026, 5, 27), confederation="X", is_host=False)


def test_normalize_strips_accents_punct_case():
    assert normalize_name("Côte d'Ivoire") == "cotedivoire"
    assert normalize_name("Türkiye") == "turkiye"
    assert normalize_name("United States") == "unitedstates"


def test_build_alias_map_auto_and_manual():
    ratings = [_rating("FR", "France"), _rating("CD", "DR Congo")]
    fd = [FdTeam("FRA", "France"), FdTeam("COD", "Congo DR")]  # 2nd needs MANUAL_ALIASES
    amap = build_alias_map(fd, ratings)
    # both name and tla map to the team_id
    assert amap["France"] == "FR" and amap["FRA"] == "FR"
    assert amap["Congo DR"] == "CD" and amap["COD"] == "CD"


def test_build_alias_map_raises_on_unknown():
    ratings = [_rating("FR", "France")]
    fd = [FdTeam("XXX", "Atlantis")]
    with pytest.raises(ValueError, match="Unresolvable"):
        build_alias_map(fd, ratings)


def test_resolve_prefers_tla_then_name():
    amap = {"NED": "NL", "Netherlands": "NL"}
    assert resolve(amap, "NED", "Netherlands") == "NL"
    assert resolve(amap, None, "Netherlands") == "NL"
    with pytest.raises(ValueError, match="Unresolved"):
        resolve(amap, "ZZZ", "Nowhere")
