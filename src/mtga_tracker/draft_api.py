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


def _seen_names(conn: sqlite3.Connection, game_ids: List[str]) -> Dict[str, set]:
    """Card names you held in each game: kept opening hand, draws, and cards
    the game summary shows you drew or played (casefolded)."""
    seen: Dict[str, set] = {}
    for start in range(0, len(game_ids), 500):
        chunk = game_ids[start : start + 500]
        marks = ",".join("?" for _ in chunk)
        for game_id, name in conn.execute(
            f"""SELECT o.game_id, c.name FROM game_opening_hand_cards o
                    JOIN participants p ON p.id = o.participant_id AND p.role = 'player'
                    JOIN cards c ON c.id = o.card_id WHERE o.game_id IN ({marks})
                UNION SELECT d.game_id, c.name FROM game_drawn_cards d
                    JOIN participants p ON p.id = d.participant_id AND p.role = 'player'
                    JOIN cards c ON c.id = d.card_id WHERE d.game_id IN ({marks})
                UNION SELECT s.game_id, c.name FROM game_card_summary s
                    JOIN participants p ON p.id = s.participant_id AND p.role = 'player'
                    JOIN cards c ON c.id = s.card_id
                    WHERE s.game_id IN ({marks}) AND (s.played_count > 0 OR s.drawn_count > 0)""",
            chunk * 3,
        ):
            if name:
                seen.setdefault(game_id, set()).add(str(name).casefold())
    return seen


def draft_analytics(db_path: Path) -> Dict[str, Any]:
    """Your own results across drafts (docs/DRAFT_REPLAY.md §2).

    Games are credited to drafts by ``game_owners`` (decklist match). Deck,
    color and event records count every credited game. A card's win rate
    counts only the games in which you held it (kept opening hand, drawn or
    played), like 17lands' games-in-hand rate: a card that sat in the library
    says nothing about it. A pair counts the games in which you held both.
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
        try:
            owners = game_owners(conn)
            seen = _seen_names(conn, sorted(owners))
        except sqlite3.Error:
            owners, seen = {}, {}
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

    def name_of(card: int) -> str:
        return str((facts.get(card) or {}).get("name") or f"Card #{card}")

    records: Dict[str, Dict[str, int]] = {}
    games_of: Dict[str, List[Tuple[str, str]]] = {}
    for game_id, (owner, outcome, _started) in owners.items():
        record = records.setdefault(owner, {"wins": 0, "losses": 0, "games": 0})
        record["games"] += 1
        record["wins"] += outcome == "win"
        record["losses"] += outcome == "loss"
        games_of.setdefault(owner, []).append((game_id, outcome))

    def held() -> Dict[str, Any]:
        return {"drafts": set(), "wins": 0, "losses": 0, "games": 0}

    def count(tally: Dict[str, Any], draft_id: str, outcome: str) -> None:
        tally["drafts"].add(draft_id)
        tally["games"] += 1
        tally["wins"] += outcome == "win"
        tally["losses"] += outcome == "loss"

    summary = _tally()
    by_colors: Dict[str, Dict[str, int]] = {}
    by_format: Dict[str, Dict[str, int]] = {}
    cards: Dict[int, Dict[str, Any]] = {}
    pairs: Dict[Tuple[int, int], Dict[str, Any]] = {}

    def entry(card: int) -> Dict[str, Any]:
        return cards.setdefault(
            card,
            {"in_hand": held(), "picked": 0, "in_deck": 0, "first_picks": 0, "pick_sum": 0},
        )

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
        picked_here = set()
        for pack, pick, taken in picks.get(draft_id, []):
            for card in taken:
                picked_here.add(card)
                entry(card)["pick_sum"] += pick
                if pack == 1 and pick == 1:
                    entry(card)["first_picks"] += 1
        for card in picked_here:
            entry(card)["picked"] += 1
        for card in played:
            entry(card)["in_deck"] += 1
        # Names held in a game map back to this draft's own cards (its pool and deck).
        by_name = {name_of(c).casefold(): c for c in picked_here | set(main) if not basic(c)}
        for game_id, outcome in games_of.get(draft_id, []):
            held_here = sorted({by_name[n] for n in seen.get(game_id, ()) if n in by_name})
            for card in held_here:
                count(entry(card)["in_hand"], draft_id, outcome)
            for i, a in enumerate(held_here):
                for b in held_here[i + 1 :]:
                    count(pairs.setdefault((a, b), held()), draft_id, outcome)

    def card_ref(card: int) -> Dict[str, Any]:
        fact = facts.get(card) or {}
        return {
            "arena_id": card,
            "name": name_of(card),
            "rarity": fact.get("rarity", "common"),
            "colors": fact.get("colors", ""),
        }

    def with_rate(tally: Dict[str, Any]) -> Dict[str, Any]:
        drafts_count = tally["drafts"] if isinstance(tally["drafts"], int) else len(tally["drafts"])
        return {**tally, "drafts": drafts_count, "win_rate": _rate(tally)}

    card_rows = []
    for card, stats in cards.items():
        if basic(card):
            continue
        card_rows.append(
            {
                **card_ref(card),
                "in_hand": with_rate(stats["in_hand"]),
                "picked": stats["picked"],
                "in_deck": stats["in_deck"],
                "first_picks": stats["first_picks"],
                # Average pick number within its pack (1 = taken first).
                "avg_pick": (
                    round(stats["pick_sum"] / stats["picked"], 1) if stats["picked"] else None
                ),
            }
        )
    card_rows.sort(key=lambda r: (-r["in_hand"]["games"], -r["picked"], r["name"]))

    notable = [
        (
            tuple(sorted(tally["drafts"])),
            {"cards": [card_ref(a), card_ref(b)], **with_rate(tally)},
        )
        for (a, b), tally in pairs.items()
        if len(tally["drafts"]) >= PAIR_MIN_DRAFTS
        and tally["wins"] + tally["losses"] >= PAIR_MIN_GAMES
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
