"""Draft Replay endpoints (docs/DRAFT_REPLAY.md).

- ``GET /api/drafts``: every captured draft, newest first.
- ``GET /api/draft?id=<draft_id>``: one draft's stream (packs, picks, card facts).
- ``POST /api/drafts/import-log``: rescan Arena's current and previous logs.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .format_normalizer import format_label

STREAM_VERSION = 1

_cards_lock = threading.Lock()
_cards = None


def _card_db():
    global _cards
    with _cards_lock:
        if _cards is None:
            from .card_database import CardDatabase

            _cards = CardDatabase()
        return _cards


def _read_conn(db_path: Path) -> Optional[sqlite3.Connection]:
    path = Path(db_path)
    if not path.is_file():
        return None
    conn = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, timeout=10)
    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'drafts'"
    ).fetchone()
    if not exists:
        conn.close()
        return None
    return conn


def _ids(raw: Optional[str]) -> List[int]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except ValueError:
        return []
    return [int(v) for v in value if isinstance(v, int)] if isinstance(value, list) else []


def _label(event_name: Optional[str], kind: str) -> str:
    if event_name:
        return format_label(event_name)
    return "Quick Draft" if kind == "bot" else "Draft"


def _main_colors(picked: List[int], facts: Dict[int, Dict[str, Any]]) -> str:
    """The pool's two most-picked colors (WUBRG order), a short identity for the list."""
    counts: Counter = Counter()
    for card in picked:
        for color in (facts.get(card) or {}).get("colors") or "":
            counts[color] += 1
    top = {color for color, _ in counts.most_common(2)}
    return "".join(c for c in "WUBRG" if c in top)


def _deck(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    """The submitted deck as ``{name, submitted_at, main, sideboard}`` piles of
    ``{arena_id, quantity}``; None when no deck was submitted."""
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except ValueError:
        return None

    def pile(name: str) -> List[Dict[str, int]]:
        return [
            {"arena_id": int(card), "quantity": int(quantity)}
            for card, quantity in value.get(name) or []
        ]

    return {
        "name": value.get("name"),
        "submitted_at": value.get("submitted_at"),
        "main": pile("main"),
        "sideboard": pile("sideboard"),
    }


def list_drafts(db_path: Path) -> Dict[str, Any]:
    conn = _read_conn(db_path)
    if conn is None:
        return {"drafts": []}
    try:
        drafts = conn.execute("""SELECT id, kind, event_name, started_at, updated_at, completed_at
               FROM drafts ORDER BY COALESCE(started_at, updated_at) DESC""").fetchall()
        picks: Dict[str, List[Tuple[int, int, List[int]]]] = {}
        for draft_id, pack, pick, picked in conn.execute(
            "SELECT draft_id, pack_number, pick_number, picked_json FROM draft_picks"
            " ORDER BY draft_id, pack_number, pick_number"
        ):
            picks.setdefault(draft_id, []).append((pack, pick, _ids(picked)))
    finally:
        conn.close()
    every_card = [card for rows in picks.values() for _, _, cards in rows for card in cards]
    facts = _card_db().draft_card_facts(every_card)
    out = []
    for draft_id, kind, event_name, started_at, updated_at, completed_at in drafts:
        rows = picks.get(draft_id, [])
        picked = [card for _, _, cards in rows for card in cards]
        first = next((cards[0] for _, _, cards in rows if cards), None)
        out.append(
            {
                "id": draft_id,
                "kind": kind,
                "event_name": event_name,
                "format_label": _label(event_name, kind),
                "started_at": started_at,
                "updated_at": updated_at,
                "completed_at": completed_at,
                "picks": len(rows),
                "packs": len({pack for pack, _, _ in rows}),
                "colors": _main_colors(picked, facts),
                "first_pick": (
                    {"arena_id": first, "name": (facts.get(first) or {}).get("name")}
                    if first
                    else None
                ),
            }
        )
    return {"drafts": out}


def draft_stream(db_path: Path, draft_id: str) -> Dict[str, Any]:
    conn = _read_conn(db_path)
    if conn is None:
        raise LookupError("No drafts have been recorded yet.")
    try:
        # A database migrated before 37 has no deck column yet (dashboard-only runs).
        columns = {row[1] for row in conn.execute("PRAGMA table_info(drafts)")}
        deck_column = "deck_json" if "deck_json" in columns else "NULL"
        draft = conn.execute(
            f"""SELECT id, kind, event_name, course_id, started_at, updated_at, completed_at,
                      card_pool_json, {deck_column} FROM drafts WHERE id = ?""",
            (draft_id,),
        ).fetchone()
        if draft is None:
            raise LookupError(f"Unknown draft: {draft_id}")
        rows = conn.execute(
            """SELECT pack_number, pick_number, pack_cards_json, picked_json, observed_at
               FROM draft_picks WHERE draft_id = ? ORDER BY pack_number, pick_number""",
            (draft_id,),
        ).fetchall()
    finally:
        conn.close()
    _, kind, event_name, course_id, started_at, updated_at, completed_at, pool_json, deck_json = (
        draft
    )
    deck = _deck(deck_json)
    picks = [
        {
            "pack": pack,
            "pick": pick,
            "pack_cards": _ids(pack_cards),
            "picked": _ids(picked),
            "observed_at": observed_at,
        }
        for pack, pick, pack_cards, picked, observed_at in rows
    ]
    pool = _ids(pool_json)
    every_card = set(pool)
    if deck:
        every_card.update(card["arena_id"] for card in deck["main"] + deck["sideboard"])
    for row in picks:
        every_card.update(row["pack_cards"])
        every_card.update(row["picked"])
    facts = _card_db().draft_card_facts(sorted(every_card))
    cards = {}
    for card in sorted(every_card):
        fact = dict(facts.get(card) or {})
        fact.setdefault("rarity", "common")
        fact["name"] = fact.get("name") or f"Card #{card}"
        fact["arena_id"] = card
        cards[str(card)] = fact
    return {
        "version": STREAM_VERSION,
        "draft": {
            "id": draft_id,
            "kind": kind,
            "event_name": event_name,
            "format_label": _label(event_name, kind),
            "course_id": course_id,
            "started_at": started_at,
            "updated_at": updated_at,
            "completed_at": completed_at,
        },
        "picks": picks,
        "pool": pool,
        "deck": deck,
        "cards": cards,
    }


def import_logs(db_path: Path) -> Dict[str, Any]:
    from .draft_capture import arena_log_paths, capture_logs
    from .log_parser import MTGALogParser

    conn = sqlite3.connect(str(db_path), timeout=10)
    try:
        conn.execute("PRAGMA busy_timeout = 10000")
        row = None
        try:
            row = conn.execute(
                "SELECT log_path FROM live_status WHERE log_path IS NOT NULL LIMIT 1"
            ).fetchone()
        except sqlite3.Error:
            pass
        log = Path(row[0]) if row and row[0] else Path(MTGALogParser._find_log_path())
        return capture_logs(conn, arena_log_paths(log))
    finally:
        conn.close()


def handle_get(path: str, query: Dict[str, List[str]], db_path: Path):
    if path == "/api/drafts":
        return 200, list_drafts(db_path)
    if path == "/api/draft":
        draft_id = (query.get("id") or [None])[0]
        if not draft_id:
            return 400, {"error": "Missing required query parameter: id"}
        try:
            return 200, draft_stream(db_path, draft_id)
        except LookupError as exc:
            return 404, {"error": "not_found", "reason": str(exc)}
    return None


def handle_post(path: str, db_path: Path):
    if path == "/api/drafts/import-log":
        try:
            return 200, import_logs(db_path)
        except (OSError, sqlite3.Error) as exc:
            return 500, {"error": f"Arena's log could not be read: {exc}"}
    return None
