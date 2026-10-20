"""17lands ratings cache for the Draft Replay heat map (offline, no network)."""

import json

from mtga_tracker import card_ratings
from mtga_tracker.card_ratings import REFRESH_SECONDS


def _rows(*cards):
    return [
        {
            "mtga_id": mtga_id,
            "ever_drawn_win_rate": wr,
            "ever_drawn_game_count": games,
            "win_rate": 0.5,
        }
        for mtga_id, wr, games in cards
    ]


class Fake17Lands:
    def __init__(self, data):
        self.data = data
        self.calls = []
        self.down = False

    def __call__(self, url):
        self.calls.append(url)
        if self.down:
            raise OSError("offline")
        for (expansion, fmt), rows in self.data.items():
            if f"expansion={expansion}&" in url and f"format={fmt}&" in url:
                return rows
        return []


def test_merges_sources_in_priority_order_and_never_substitutes(tmp_path):
    fake = Fake17Lands(
        {
            ("FRA", "QuickDraft"): _rows((1, None, 80), (2, 0.61, 900)),
            ("FRA", "PremierDraft"): _rows((1, 0.55, 5000), (2, 0.5, 9000), (3, None, 447)),
        }
    )
    result = card_ratings.card_ratings(
        tmp_path, ["fra"], ["QuickDraft", "PremierDraft"], fetch=fake, now=1000.0
    )
    cards = result["cards"]
    assert cards["1"] == {"gih_wr": 0.55, "games": 5000}
    assert cards["2"] == {"gih_wr": 0.61, "games": 900}
    # No published games-in-hand rate: stays null (shown grey), no game-played fallback.
    assert cards["3"] == {"gih_wr": None, "games": 447}
    assert [s["format"] for s in result["sources"]] == ["QuickDraft", "PremierDraft"]
    assert result["fetched_at"] == 1000.0


def test_cache_on_disk_refreshes_daily_and_survives_going_offline(tmp_path):
    fake = Fake17Lands({("FRA", "PremierDraft"): _rows((1, 0.55, 5000))})
    first = card_ratings.card_ratings(tmp_path, ["FRA"], ["PremierDraft"], fetch=fake, now=1000.0)
    saved = json.loads((tmp_path / "FRA.PremierDraft.json").read_text())
    assert saved["rows"] == [{"mtga_id": 1, "gih_wr": 0.55, "gih_games": 5000}]

    # Within a day: served from disk, no request.
    again = card_ratings.card_ratings(tmp_path, ["FRA"], ["PremierDraft"], fetch=fake, now=2000.0)
    assert len(fake.calls) == 1 and again["cards"] == first["cards"]

    # A day later and offline: the saved copy is still served.
    fake.down = True
    later = card_ratings.card_ratings(
        tmp_path, ["FRA"], ["PremierDraft"], fetch=fake, now=1000.0 + REFRESH_SECONDS + 1
    )
    assert len(fake.calls) == 2 and later["cards"]["1"]["gih_wr"] == 0.55

    # Back online: refreshed.
    fake.down = False
    fake.data[("FRA", "PremierDraft")] = _rows((1, 0.57, 6000))
    fresh = card_ratings.card_ratings(
        tmp_path, ["FRA"], ["PremierDraft"], fetch=fake, now=1000.0 + REFRESH_SECONDS + 2
    )
    assert fresh["cards"]["1"]["gih_wr"] == 0.57


def test_rejects_unknown_formats_and_odd_expansions(tmp_path):
    fake = Fake17Lands({})
    result = card_ratings.card_ratings(
        tmp_path, ["../etc", "FRA"], ["Bogus", "PremierDraft"], fetch=fake, now=1.0
    )
    assert [s["expansion"] for s in result["sources"]] == ["FRA"]
    assert all("Bogus" not in url and "etc" not in url for url in fake.calls)


def test_endpoint_needs_sources_and_caches_beside_the_database(tmp_path, monkeypatch):
    seen = {}

    def fake_ratings(cache_dir, expansions, formats):
        seen.update(cache_dir=cache_dir, expansions=expansions, formats=formats)
        return {"cards": {}, "sources": [], "fetched_at": None}

    monkeypatch.setattr(card_ratings, "card_ratings", fake_ratings)
    db = tmp_path / "data" / "tracker.sqlite3"
    assert card_ratings.handle_get({}, db)[0] == 400
    status, _ = card_ratings.handle_get(
        {"expansions": ["FRA,Y26FRA"], "formats": ["QuickDraft,PremierDraft"]}, db
    )
    assert status == 200
    assert seen == {
        "cache_dir": tmp_path / "data" / "card_ratings",
        "expansions": ["FRA", "Y26FRA"],
        "formats": ["QuickDraft", "PremierDraft"],
    }
