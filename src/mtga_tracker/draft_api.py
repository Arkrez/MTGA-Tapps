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
from datetime import datetime, timezone
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


def _utc(value: Optional[str]) -> Optional[datetime]:
    """An ISO time as aware UTC. Game rows store naive local time; drafts store UTC."""
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.astimezone()
    return moment.astimezone(timezone.utc)


#: Share of a draft's final main deck (by distinct card) that a game's submitted
#: deck must contain to count as that draft's game.
DECK_MATCH = 0.8


def game_owners(
    conn: sqlite3.Connection, *, deck_only: bool = False
) -> Dict[str, Tuple[str, str, Optional[str]]]:
    """Which draft each game of a draft event was played with:
    ``{game_id: (draft_id, outcome, started_at)}``.

    The game's submitted deck is matched against each draft's final deck of the
    same event (the best match covering at least ``DECK_MATCH`` of it wins), so
    clocks do not matter. Games no deck matches fall back to time: the latest
    draft of the event that started before the game.
    """
    columns = {row[1] for row in conn.execute("PRAGMA table_info(drafts)")}
    deck_column = "deck_json" if "deck_json" in columns else "NULL"
    drafts = conn.execute(
        f"SELECT id, event_name, started_at, {deck_column} FROM drafts WHERE event_name IS NOT NULL"
    ).fetchall()
    events = sorted({row[1] for row in drafts})
    if not events:
        return {}
    marks = ",".join("?" for _ in events)
    try:
        games = conn.execute(
            f"""SELECT g.id, COALESCE(m.event_name, m.queue), g.started_at, g.outcome
                FROM games g JOIN matches m ON m.id = g.match_id
                WHERE COALESCE(m.event_name, m.queue) IN ({marks})""",
            events,
        ).fetchall()
        game_cards: Dict[str, set] = {}
        for game_id, arena_id in conn.execute(
            f"""SELECT gdc.game_id, gdc.arena_id FROM game_deck_cards gdc
                JOIN participants p ON p.id = gdc.participant_id
                JOIN games g ON g.id = gdc.game_id
                JOIN matches m ON m.id = g.match_id
                WHERE p.role = 'player' AND gdc.deck_zone = 'deck'
                  AND gdc.arena_id IS NOT NULL
                  AND COALESCE(m.event_name, m.queue) IN ({marks})""",
            events,
        ):
            game_cards.setdefault(game_id, set()).add(int(arena_id))
    except sqlite3.Error:
        return {}
    decks: Dict[str, List[Tuple[str, set]]] = {}
    windows: Dict[str, List[Tuple[datetime, str]]] = {}
    for draft_id, event, started_at, deck_json in drafts:
        deck = _deck(deck_json)
        if deck and deck["main"]:
            decks.setdefault(event, []).append(
                (draft_id, {card["arena_id"] for card in deck["main"]})
            )
        start = _utc(started_at)
        if start:
            windows.setdefault(event, []).append((start, draft_id))
    for spans in windows.values():
        spans.sort()
    owners: Dict[str, Tuple[str, str, Optional[str]]] = {}
    for game_id, event, started_at, outcome in games:
        owner = None
        cards = game_cards.get(game_id)
        if cards:
            scored = [
                (len(cards & main) / len(main), draft_id) for draft_id, main in decks.get(event, [])
            ]
            best = max(scored, default=(0.0, None))
            if best[0] >= DECK_MATCH:
                owner = best[1]
        if owner is None and not deck_only:
            played = _utc(started_at)
            for start, draft_id in windows.get(event, []):
                if played and start <= played:
                    owner = draft_id
        if owner is not None:
            owners[game_id] = (owner, outcome, started_at)
    return owners


def _draft_records(conn: sqlite3.Connection) -> Dict[str, Dict[str, int]]:
    """Wins and losses per draft, from the games ``game_owners`` credits to it."""
    try:
        owners = game_owners(conn)
    except sqlite3.Error:
        return {}
    records: Dict[str, Dict[str, int]] = {}
    for owner, outcome, _started in owners.values():
        record = records.setdefault(owner, {"wins": 0, "losses": 0, "games": 0})
        record["games"] += 1
        if outcome == "win":
            record["wins"] += 1
        elif outcome == "loss":
            record["losses"] += 1
    return records


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
        records = _draft_records(conn)
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
                "record": records.get(draft_id, {"wins": 0, "losses": 0, "games": 0}),
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


#: A pair must have been in at least this many decks, and this many decided
#: games, before it counts as notable (smaller samples are mostly noise).
PAIR_MIN_DRAFTS = 2
PAIR_MIN_GAMES = 4
NOTABLE_PAIRS = 12
#: Most pairs shown from one exact set of drafts: two decks that went 11-1
#: otherwise fill the whole list with every pair of their cards.
PAIRS_PER_DECK_SET = 2


def _tally() -> Dict[str, int]:
    return {"drafts": 0, "wins": 0, "losses": 0, "games": 0}


def _add(tally: Dict[str, int], record: Dict[str, int]) -> None:
    tally["drafts"] += 1
    for key in ("wins", "losses", "games"):
        tally[key] += record.get(key, 0)


def _rate(tally: Dict[str, int]) -> Optional[float]:
    decided = tally["wins"] + tally["losses"]
    return tally["wins"] / decided if decided else None


def draft_analytics(db_path: Path) -> Dict[str, Any]:
    """Your own results across drafts (docs/DRAFT_REPLAY.md §2).

    Games are credited to a draft as on the draft tiles (its event, from the
    draft until the next draft of that event). A card's "in deck" record sums
    the drafts whose final main deck played it; "picked" sums the drafts in
    which you took it. Pairs are two non-basic cards in the same final deck.
    """
    empty = {
        "summary": {**_tally(), "win_rate": None},
        "colors": [],
        "formats": [],
        "cards": [],
        "pairs": {"best": [], "worst": []},
        "pair_rules": {"min_drafts": PAIR_MIN_DRAFTS, "min_games": PAIR_MIN_GAMES},
    }
    conn = _read_conn(db_path)
    if conn is None:
        return empty
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(drafts)")}
        deck_column = "deck_json" if "deck_json" in columns else "NULL"
        drafts = conn.execute(
            f"""SELECT id, kind, event_name, started_at, updated_at, completed_at, {deck_column}
                FROM drafts ORDER BY COALESCE(started_at, updated_at)"""
        ).fetchall()
        picks: Dict[str, List[Tuple[int, int, List[int]]]] = {}
        for draft_id, pack, pick, picked in conn.execute(
            "SELECT draft_id, pack_number, pick_number, picked_json FROM draft_picks"
            " ORDER BY draft_id, pack_number, pick_number"
        ):
            picks.setdefault(draft_id, []).append((pack, pick, _ids(picked)))
        records = _draft_records(conn)
    finally:
        conn.close()
    if not drafts:
        return empty

    decks = {row[0]: _deck(row[6]) for row in drafts}
    every_card = {c for rows in picks.values() for _, _, cards in rows for c in cards}
    for deck in decks.values():
        if deck:
            every_card.update(card["arena_id"] for card in deck["main"])
    facts = _card_db().draft_card_facts(sorted(every_card))

    def basic(card: int) -> bool:
        return (facts.get(card) or {}).get("rarity") == "basic"

    summary = _tally()
    by_colors: Dict[str, Dict[str, int]] = {}
    by_format: Dict[str, Dict[str, int]] = {}
    cards: Dict[int, Dict[str, Any]] = {}
    pairs: Dict[Tuple[int, int], Dict[str, int]] = {}
    pair_drafts: Dict[Tuple[int, int], List[str]] = {}
    for draft_id, kind, event_name, *_rest in drafts:
        record = records.get(draft_id, {"wins": 0, "losses": 0, "games": 0})
        deck = decks.get(draft_id)
        main = sorted({c["arena_id"] for c in deck["main"]} if deck else set())
        played = [c for c in main if not basic(c)]
        if record["games"]:
            _add(summary, record)
            colors = _main_colors(played, facts) or "C"
            _add(by_colors.setdefault(colors, _tally()), record)
            _add(by_format.setdefault(_label(event_name, kind), _tally()), record)
        rows = picks.get(draft_id, [])
        order = 0
        picked_here: Dict[int, int] = {}
        for pack, pick, taken in rows:
            for card in taken:
                order += 1
                picked_here.setdefault(card, order)
                entry = cards.setdefault(
                    card,
                    {"picked": _tally(), "in_deck": _tally(), "first_picks": 0, "pick_sum": 0},
                )
                entry["pick_sum"] += pick
                if pack == 1 and pick == 1:
                    entry["first_picks"] += 1
        for card in picked_here:
            _add(cards[card]["picked"], record)
        for card in played:
            entry = cards.setdefault(
                card, {"picked": _tally(), "in_deck": _tally(), "first_picks": 0, "pick_sum": 0}
            )
            _add(entry["in_deck"], record)
        if record["games"]:
            for i, a in enumerate(played):
                for b in played[i + 1 :]:
                    _add(pairs.setdefault((a, b), _tally()), record)
                    pair_drafts.setdefault((a, b), []).append(draft_id)

    def card_ref(card: int) -> Dict[str, Any]:
        fact = facts.get(card) or {}
        return {
            "arena_id": card,
            "name": fact.get("name") or f"Card #{card}",
            "rarity": fact.get("rarity", "common"),
            "colors": fact.get("colors", ""),
        }

    def with_rate(tally: Dict[str, int]) -> Dict[str, Any]:
        return {**tally, "win_rate": _rate(tally)}

    card_rows = []
    for card, entry in cards.items():
        if basic(card):
            continue
        times = entry["picked"]["drafts"]
        card_rows.append(
            {
                **card_ref(card),
                "picked": with_rate(entry["picked"]),
                "in_deck": with_rate(entry["in_deck"]),
                "first_picks": entry["first_picks"],
                # Average pick number within its pack (1 = taken first).
                "avg_pick": round(entry["pick_sum"] / times, 1) if times else None,
            }
        )
    card_rows.sort(key=lambda r: (-r["in_deck"]["games"], -r["picked"]["drafts"], r["name"]))

    notable = [
        (tuple(pair_drafts[(a, b)]), {"cards": [card_ref(a), card_ref(b)], **with_rate(tally)})
        for (a, b), tally in pairs.items()
        if tally["drafts"] >= PAIR_MIN_DRAFTS and tally["wins"] + tally["losses"] >= PAIR_MIN_GAMES
    ]

    def varied(ranked: List[Tuple[Tuple[str, ...], Dict[str, Any]]]) -> List[Dict[str, Any]]:
        shown: List[Dict[str, Any]] = []
        per_set: Counter = Counter()
        for drafts_key, pair in ranked:
            if per_set[drafts_key] >= PAIRS_PER_DECK_SET:
                continue
            per_set[drafts_key] += 1
            shown.append(pair)
            if len(shown) == NOTABLE_PAIRS:
                break
        return shown

    # Most games first among equal rates: a 10-2 pair says more than a 5-1 one.
    best = varied(sorted(notable, key=lambda p: (-(p[1]["win_rate"] or 0), -p[1]["games"])))
    worst = varied(sorted(notable, key=lambda p: ((p[1]["win_rate"] or 0), -p[1]["games"])))

    def grouped(groups: Dict[str, Dict[str, int]], key: str) -> List[Dict[str, Any]]:
        return sorted(
            ({key: name, **with_rate(t)} for name, t in groups.items()),
            key=lambda row: (-row["games"], row[key]),
        )

    return {
        "summary": with_rate(summary),
        "colors": grouped(by_colors, "colors"),
        "formats": grouped(by_format, "format_label"),
        "cards": card_rows,
        "pairs": {"best": best, "worst": worst},
        "pair_rules": {"min_drafts": PAIR_MIN_DRAFTS, "min_games": PAIR_MIN_GAMES},
    }


def handle_get(path: str, query: Dict[str, List[str]], db_path: Path):
    if path == "/api/drafts":
        return 200, list_drafts(db_path)
    if path == "/api/drafts/analytics":
        return 200, draft_analytics(db_path)
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
