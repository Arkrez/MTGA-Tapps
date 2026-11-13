"""17lands card ratings for the Draft Replay heat map, cached on disk.

17lands publishes per-card draft statistics keyed by Arena id at
``/card_ratings/data``. The tracker downloads each (expansion, format) once,
keeps it as a small JSON file next to the analytics database
(``card_ratings/<EXP>.<Format>.json``) and refreshes it at most once a day,
so replays keep their numbers offline and later. A failed download serves
the last saved copy.

The viewer shows games-in-hand win rate (GIH WR) only. 17lands withholds it
until a card has enough games; such cards come back with a null rate and
their game count, and the viewer shows them grey rather than substituting
another statistic.
"""

from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional

API = "https://www.17lands.com/card_ratings/data"
REFRESH_SECONDS = 24 * 60 * 60
START_DATE = "2020-01-01"
FORMATS = ("PremierDraft", "QuickDraft", "TradDraft", "PickTwoDraft", "Sealed", "TradSealed")
_EXPANSION = re.compile(r"^[A-Z0-9]{2,10}$")

Fetcher = Callable[[str], Any]


def _download(url: str) -> Any:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "TappsTracker (local MTGA tracker)", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310 - fixed https host
        return json.loads(response.read().decode("utf-8"))


def _reduce(rows: Any) -> List[Dict[str, Any]]:
    """Only what the viewer needs, so each cached file stays a few KB."""
    out = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or not isinstance(row.get("mtga_id"), int):
            continue
        out.append(
            {
                "mtga_id": row["mtga_id"],
                "gih_wr": row.get("ever_drawn_win_rate"),
                "gih_games": row.get("ever_drawn_game_count") or 0,
            }
        )
    return out


def _source(
    cache_dir: Path, expansion: str, fmt: str, fetch: Fetcher, now: float
) -> Optional[Dict[str, Any]]:
    path = cache_dir / f"{expansion}.{fmt}.json"
    cached = None
    try:
        cached = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cached = None
    if cached and now - float(cached.get("fetched_at") or 0) < REFRESH_SECONDS:
        return cached
    query = urllib.parse.urlencode(
        {"expansion": expansion, "format": fmt, "start_date": START_DATE}
    )
    try:
        rows = _reduce(fetch(f"{API}?{query}"))
    except Exception:  # noqa: BLE001 - offline or 17lands down: keep the last copy
        return cached
    fresh = {"fetched_at": now, "expansion": expansion, "format": fmt, "rows": rows}
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(fresh), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        pass
    return fresh


def card_ratings(
    cache_dir: Path,
    expansions: Iterable[str],
    formats: Iterable[str],
    *,
    fetch: Fetcher = _download,
    now: Optional[float] = None,
) -> Dict[str, Any]:
    """Merged ratings for these sources, in priority order (first published value wins).

    Returns ``{"cards": {mtga_id: {gih_wr, games}}, "sources": [...],
    "fetched_at": oldest fetch time or None}``.
    """
    now = time.time() if now is None else now
    exps = [e for e in (str(x).upper() for x in expansions) if _EXPANSION.match(e)][:4]
    fmts = [f for f in formats if f in FORMATS][:4]
    cards: Dict[str, Dict[str, Any]] = {}
    sources = []
    fetched = []
    for expansion in exps:
        for fmt in fmts:
            source = _source(Path(cache_dir), expansion, fmt, fetch, now)
            if not source:
                continue
            sources.append(
                {"expansion": expansion, "format": fmt, "fetched_at": source["fetched_at"]}
            )
            fetched.append(source["fetched_at"])
            for row in source.get("rows") or []:
                card = cards.setdefault(str(row["mtga_id"]), {"gih_wr": None, "games": 0})
                if card["gih_wr"] is not None:
                    continue
                if row.get("gih_wr") is not None:
                    card["gih_wr"] = row["gih_wr"]
                    card["games"] = row.get("gih_games") or 0
                else:
                    card["games"] = max(card["games"], row.get("gih_games") or 0)
    return {"cards": cards, "sources": sources, "fetched_at": min(fetched) if fetched else None}


def handle_get(query: Dict[str, List[str]], db_path: Path):
    def values(name: str) -> List[str]:
        return [v for raw in query.get(name, []) for v in raw.split(",") if v]

    expansions, formats = values("expansions"), values("formats")
    if not expansions or not formats:
        return 400, {"error": "expansions and formats are required"}
    cache_dir = Path(db_path).expanduser().parent / "card_ratings"
    return 200, card_ratings(cache_dir, expansions, formats)
