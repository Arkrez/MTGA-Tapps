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
from .limited_runs import load_runs
from .limited_runs import parse_deck as _deck

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


def game_owners(
    conn: sqlite3.Connection, *, deck_only: bool = False
) -> Dict[str, Tuple[str, str, Optional[str]]]:
    """Which run each limited game was played in: ``{game_id: (run_id, outcome,
    started_at)}`` (see limited_runs). ``deck_only`` credits games to captured
    runs by pool alone."""
    owners = {}
    for run in load_runs(conn, captured_only=deck_only):
        for game in run.games:
            owners[game.id] = (run.id, game.outcome, game.started_at)
    return owners


def _rarest(cards: List[int], facts: Dict[int, Dict[str, Any]]) -> Optional[int]:
    """The card to show for a run without a first pick: its rarest, costliest card."""
    order = {"mythic": 0, "rare": 1, "uncommon": 2, "common": 3, "basic": 4}
    ranked = sorted(
        (c for c in cards if (facts.get(c) or {}).get("rarity") != "basic"),
        key=lambda c: (
            order.get((facts.get(c) or {}).get("rarity", "common"), 3),
            -((facts.get(c) or {}).get("mana_value") or 0),
            c,
        ),
    )
    return ranked[0] if ranked else None


def game_run_tags(conn: sqlite3.Connection) -> Dict[str, Dict[str, Any]]:
    """For /api/games: each limited game's run, so Recent games groups by run
    instead of by the shared "Draft Deck" / "Sealed Deck" name."""
    try:
        runs = load_runs(conn)
    except sqlite3.Error:
        return {}
    every_card = set()
    for run in runs:
        if run.games:
            every_card.update(card["arena_id"] for card in (run.deck or {}).get("main", []))
            for _, _, taken in run.picks[:1]:
                every_card.update(taken)
    facts = _card_db().draft_card_facts(sorted(every_card)) if every_card else {}
    tags: Dict[str, Dict[str, Any]] = {}
    for run in runs:
        if not run.games:
            continue
        first = next((cards[0] for _, _, cards in run.picks if cards), None)
        main = [card["arena_id"] for card in (run.deck or {}).get("main", [])]
        shown = first or _rarest(main, facts)
        tag = {
            "id": run.id,
            "kind": run.kind,
            "label": _label(run.event_name, run.kind),
            "started_at": run.started_at,
            "rebuilt": run.rebuilt,
            "art": (
                {"arena_id": shown, "name": (facts.get(shown) or {}).get("name")} if shown else None
            ),
        }
        for game in run.games:
            tags[game.id] = tag
    return tags


def list_drafts(db_path: Path) -> Dict[str, Any]:
    """Every limited run (drafts, sealed courses, runs rebuilt from games), newest first."""
    conn = _read_conn(db_path)
    if conn is None:
        return {"drafts": []}
    try:
        runs = load_runs(conn)
    except sqlite3.Error:
        runs = []
    finally:
        conn.close()
    every_card = set()
    for run in runs:
        every_card.update(run.cards())
    facts = _card_db().draft_card_facts(sorted(every_card))
    out = []
    for run in sorted(runs, key=lambda r: r.started_at or r.updated_at or "", reverse=True):
        picked = [card for _, _, cards in run.picks for card in cards]
        main = [card["arena_id"] for card in (run.deck or {}).get("main", [])]
        first = next((cards[0] for _, _, cards in run.picks if cards), None)
        shown = first or _rarest(main or sorted(run.cards()), facts)
        out.append(
            {
                "id": run.id,
                "kind": run.kind,
                "event_name": run.event_name,
                "format_label": _label(run.event_name, run.kind),
                "started_at": run.started_at,
                "updated_at": run.updated_at,
                "completed_at": run.completed_at,
                "picks": len(run.picks),
                "packs": len({pack for pack, _, _ in run.picks}),
                "pool_size": len(run.pool) or len(set(picked)),
                "rebuilt": run.rebuilt,
                "colors": _main_colors(
                    [c for c in main if (facts.get(c) or {}).get("rarity") != "basic"] or picked,
                    facts,
                ),
                "record": run.record,
                "first_pick": (
                    {"arena_id": first, "name": (facts.get(first) or {}).get("name")}
                    if first
                    else None
                ),
                "top_card": (
                    {"arena_id": shown, "name": (facts.get(shown) or {}).get("name")}
                    if shown
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
        try:
            run = next((r for r in load_runs(conn) if r.id == draft_id), None)
        except sqlite3.Error:
            run = None
        rebuilt = run if run is not None and run.rebuilt else None
        if draft is None and rebuilt is None:
            raise LookupError(f"Unknown draft: {draft_id}")
        rows = conn.execute(
            """SELECT pack_number, pick_number, pack_cards_json, picked_json, observed_at
               FROM draft_picks WHERE draft_id = ? ORDER BY pack_number, pick_number""",
            (draft_id,),
        ).fetchall()
    finally:
        conn.close()
    if rebuilt is not None:
        kind, event_name, course_id = rebuilt.kind, rebuilt.event_name, None
        started_at, updated_at, completed_at = rebuilt.started_at, rebuilt.updated_at, None
        pool_json, deck = json.dumps(rebuilt.pool), rebuilt.deck
    else:
        (
            _,
            kind,
            event_name,
            course_id,
            started_at,
            updated_at,
            completed_at,
            pool_json,
            deck_json,
        ) = draft
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
            "rebuilt": rebuilt is not None,
            "record": run.record if run else {"wins": 0, "losses": 0, "games": 0},
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
        runs = load_runs(conn)
        seen = _seen_names(conn, sorted(game.id for run in runs for game in run.games))
    except sqlite3.Error:
        runs, seen = [], {}
    finally:
        conn.close()
    if not runs:
        return empty

    every_card = set()
    for run in runs:
        every_card.update(run.cards())
    facts = _card_db().draft_card_facts(sorted(every_card))

    def basic(card: int) -> bool:
        return (facts.get(card) or {}).get("rarity") == "basic"

    def name_of(card: int) -> str:
        return str((facts.get(card) or {}).get("name") or f"Card #{card}")

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

    for run in runs:
        record = run.record
        main = sorted({c["arena_id"] for c in run.deck["main"]} if run.deck else set())
        played = [c for c in main if not basic(c)]
        if record["games"]:
            _add(summary, record)
            colors = _main_colors(played, facts) or "C"
            _add(by_colors.setdefault(colors, _tally()), record)
            _add(by_format.setdefault(_label(run.event_name, run.kind), _tally()), record)
        picked_here = set()
        for pack, pick, taken in run.picks:
            for card in taken:
                picked_here.add(card)
                entry(card)["pick_sum"] += pick
                if pack == 1 and pick == 1:
                    entry(card)["first_picks"] += 1
        for card in picked_here:
            entry(card)["picked"] += 1
        for card in played:
            entry(card)["in_deck"] += 1
        # Names held in a game map back to this run's own cards (its pool and deck).
        by_name = {name_of(c).casefold(): c for c in run.cards() if not basic(c)}
        for game in run.games:
            held_here = sorted({by_name[n] for n in seen.get(game.id, ()) if n in by_name})
            for card in held_here:
                count(entry(card)["in_hand"], run.id, game.outcome)
            for i, a in enumerate(held_here):
                for b in held_here[i + 1 :]:
                    count(pairs.setdefault((a, b), held()), run.id, game.outcome)

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
