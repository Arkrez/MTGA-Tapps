"""Limited runs: every draft or sealed course, and which games belong to it.

A *run* is one entry into a limited event: a draft (its picks), a sealed
course (its pool), or, when the log that had them is gone, a run rebuilt from
the games themselves. Games are credited to runs by deck, never by name: every
limited deck is called "Draft Deck" or "Sealed Deck", but a run's deck can only
be built from its own pool (docs/DRAFT_REPLAY.md §2).

1. A game belongs to the captured run of its event whose pool (picks or sealed
   pool, plus its submitted deck) holds at least ``POOL_MATCH`` of the game's
   non-basic cards.
2. Games no captured run explains are grouped into rebuilt runs: consecutive
   games of an event stay in one run while their decks keep drawing on the
   same cards (``REBUILT_MATCH`` of them already seen in that run).
3. A game without a recorded decklist falls back to time: the latest run of
   its event that started before it.
"""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

POOL_MATCH = 0.9
REBUILT_MATCH = 0.7
BASIC_LANDS = {"plains", "island", "swamp", "mountain", "forest", "wastes"}
_LIMITED_EVENT = re.compile(r"draft|sealed|cube", re.IGNORECASE)


def is_limited_event(event: Optional[str]) -> bool:
    return bool(event) and bool(_LIMITED_EVENT.search(str(event)))


def to_utc(value: Optional[str]) -> Optional[datetime]:
    """An ISO time as aware UTC. Game rows store naive local time; runs store UTC."""
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.astimezone()
    return moment.astimezone(timezone.utc)


def _ids(raw: Optional[str]) -> List[int]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except ValueError:
        return []
    return [int(v) for v in value if isinstance(v, int)] if isinstance(value, list) else []


def parse_deck(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    """A stored submission as ``{name, submitted_at, main, sideboard}`` piles of
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


@dataclass
class Game:
    id: str
    event: str
    started_at: Optional[str]
    outcome: Optional[str]
    #: Non-basic cards of the submitted main deck.
    cards: set = field(default_factory=set)
    #: The whole submission: {"main": [...], "sideboard": [...]} of {arena_id, quantity}.
    deck: Dict[str, List[Dict[str, int]]] = field(default_factory=dict)


@dataclass
class Run:
    id: str
    kind: str  # "bot" / "player" (drafts) or "sealed"
    event_name: Optional[str]
    course_id: Optional[str] = None
    started_at: Optional[str] = None
    updated_at: Optional[str] = None
    completed_at: Optional[str] = None
    #: Captured sealed pool, or the cards a draft picked.
    pool: List[int] = field(default_factory=list)
    deck: Optional[Dict[str, Any]] = None
    picks: List[Tuple[int, int, List[int]]] = field(default_factory=list)
    #: Rebuilt from games because the log with the course is gone.
    rebuilt: bool = False
    games: List[Game] = field(default_factory=list)

    def cards(self) -> set:
        held = set(self.pool)
        for _, _, taken in self.picks:
            held.update(taken)
        if self.deck:
            held.update(card["arena_id"] for card in self.deck["main"] + self.deck["sideboard"])
        return held

    @property
    def record(self) -> Dict[str, int]:
        wins = sum(game.outcome == "win" for game in self.games)
        losses = sum(game.outcome == "loss" for game in self.games)
        return {"wins": wins, "losses": losses, "games": len(self.games)}


def _coverage(cards: set, pool: set) -> float:
    return len(cards & pool) / len(cards) if cards else 0.0


def _captured(conn: sqlite3.Connection) -> List[Run]:
    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'drafts'"
    ).fetchone()
    if not exists:
        return []
    columns = {row[1] for row in conn.execute("PRAGMA table_info(drafts)")}
    deck_column = "deck_json" if "deck_json" in columns else "NULL"
    runs: Dict[str, Run] = {}
    for row in conn.execute(
        f"""SELECT id, kind, event_name, course_id, started_at, updated_at, completed_at,
                   card_pool_json, {deck_column}
            FROM drafts ORDER BY COALESCE(started_at, updated_at)"""
    ):
        draft_id, kind, event, course, started, updated, completed, pool, deck = row
        runs[draft_id] = Run(
            id=draft_id,
            kind=kind,
            event_name=event,
            course_id=course,
            started_at=started,
            updated_at=updated,
            completed_at=completed,
            # The pool Arena reported: a sealed run's handed-out pool, a draft's final picks.
            pool=_ids(pool),
            deck=parse_deck(deck),
        )
    for draft_id, pack, pick, picked in conn.execute(
        "SELECT draft_id, pack_number, pick_number, picked_json FROM draft_picks"
        " ORDER BY draft_id, pack_number, pick_number"
    ):
        if draft_id in runs:
            runs[draft_id].picks.append((pack, pick, _ids(picked)))
    return list(runs.values())


def _games(conn: sqlite3.Connection, events: List[str]) -> List[Game]:
    try:
        rows = conn.execute("""SELECT g.id, COALESCE(m.event_name, m.queue), g.started_at, g.outcome
               FROM games g JOIN matches m ON m.id = g.match_id""").fetchall()
    except sqlite3.Error:
        return []
    wanted = set(events)
    games = {
        game_id: Game(id=game_id, event=event, started_at=started, outcome=outcome)
        for game_id, event, started, outcome in rows
        if event and (event in wanted or is_limited_event(event))
    }
    if not games:
        return []
    ids = list(games)
    for start in range(0, len(ids), 500):
        chunk = ids[start : start + 500]
        marks = ",".join("?" for _ in chunk)
        for game_id, arena_id, name, zone, quantity in conn.execute(
            f"""SELECT gdc.game_id, gdc.arena_id, gdc.display_name, gdc.deck_zone, gdc.quantity
                FROM game_deck_cards gdc
                JOIN participants p ON p.id = gdc.participant_id AND p.role = 'player'
                WHERE gdc.game_id IN ({marks}) AND gdc.arena_id IS NOT NULL""",
            chunk,
        ):
            game = games[game_id]
            pile = "main" if zone == "deck" else "sideboard"
            game.deck.setdefault(pile, []).append(
                {"arena_id": int(arena_id), "quantity": int(quantity or 1)}
            )
            if zone == "deck" and str(name or "").casefold() not in BASIC_LANDS:
                game.cards.add(int(arena_id))
    return sorted(
        games.values(),
        key=lambda g: (to_utc(g.started_at) or datetime.min.replace(tzinfo=timezone.utc), g.id),
    )


def load_runs(conn: sqlite3.Connection, *, captured_only: bool = False) -> List[Run]:
    """Every run with its games, oldest first. ``captured_only`` credits games to
    captured runs by pool alone (no rebuilt runs, no time fallback)."""
    runs = _captured(conn)
    events = sorted({run.event_name for run in runs if run.event_name})
    games = _games(conn, events)
    by_event: Dict[str, List[Run]] = {}
    for run in runs:
        if run.event_name:
            by_event.setdefault(run.event_name, []).append(run)
    # Pool matching only considers captured runs; rebuilt ones are added below.
    captured_by_event = {event: list(found) for event, found in by_event.items()}
    pools = {run.id: run.cards() for run in runs}
    open_rebuilt: Dict[str, Tuple[Run, set]] = {}
    undecked: List[Game] = []
    for game in games:
        if not game.cards:
            undecked.append(game)
            continue
        played = to_utc(game.started_at)
        scored = []
        for run in captured_by_event.get(game.event, []):
            coverage = _coverage(game.cards, pools[run.id])
            started = to_utc(run.started_at)
            before = bool(played and started and started <= played)
            scored.append((coverage, before, started or played, run))
        best = max(scored, key=lambda s: (s[0], s[1], s[2]), default=None)
        if best and best[0] >= POOL_MATCH:
            best[3].games.append(game)
            continue
        if captured_only:
            continue
        current = open_rebuilt.get(game.event)
        if current and _coverage(game.cards, current[1]) >= REBUILT_MATCH:
            current[0].games.append(game)
            current[1].update(game.cards)
            continue
        rebuilt = Run(
            id=f"games-{game.id}",
            kind="sealed" if "sealed" in game.event.casefold() else "player",
            event_name=game.event,
            started_at=played.isoformat() if played else None,
            rebuilt=True,
        )
        rebuilt.games.append(game)
        open_rebuilt[game.event] = (rebuilt, set(game.cards))
        runs.append(rebuilt)
        by_event.setdefault(game.event, []).append(rebuilt)
    for run in runs:
        if run.rebuilt and run.games:
            last = run.games[-1]
            ended = to_utc(last.started_at)
            run.updated_at = ended.isoformat() if ended else None
            run.deck = {
                "name": None,
                "submitted_at": run.updated_at,
                "main": last.deck.get("main", []),
                "sideboard": last.deck.get("sideboard", []),
            }
            # Sealed submissions carry the rest of the pool as sideboard.
            pool = set()
            for game in run.games:
                pool |= game.cards
                pool |= {card["arena_id"] for card in game.deck.get("sideboard", [])}
            run.pool = sorted(pool)
    if not captured_only:
        for game in undecked:
            played = to_utc(game.started_at)
            owner = None
            for run in sorted(
                by_event.get(game.event, []),
                key=lambda r: to_utc(r.started_at)
                or played
                or datetime.min.replace(tzinfo=timezone.utc),
            ):
                started = to_utc(run.started_at)
                if played and started and started <= played:
                    owner = run
            if owner:
                owner.games.append(game)
    for run in runs:
        run.games.sort(
            key=lambda g: (to_utc(g.started_at) or datetime.min.replace(tzinfo=timezone.utc), g.id)
        )
        # A course first seen at a later login started no later than its first game.
        first = to_utc(run.games[0].started_at) if run.games else None
        started = to_utc(run.started_at)
        if first and (not started or first < started):
            run.started_at = first.isoformat()
    return sorted(
        runs,
        key=lambda r: (to_utc(r.started_at) or datetime.min.replace(tzinfo=timezone.utc), r.id),
    )


def game_runs(conn: sqlite3.Connection, *, captured_only: bool = False) -> Dict[str, Run]:
    """``{game_id: run}`` for every game credited to a run."""
    return {
        game.id: run for run in load_runs(conn, captured_only=captured_only) for game in run.games
    }
