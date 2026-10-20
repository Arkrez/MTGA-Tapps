"""Capture Arena draft picks from the log for the Draft Replay viewer.

Arena logs two draft shapes (see docs/DRAFT_REPLAY.md):

- Bot drafts (Quick Draft): ``<== BotDraftDraftStatus`` / ``<== BotDraftDraftPick``
  responses carry the pack in front of the player (0-based ``PackNumber`` /
  ``PickNumber``, ``DraftPack``) and every card picked so far (``PickedCards``);
  the ``==> BotDraftDraftPick`` request names the card taken.
- Player drafts (Premier, Traditional, Pick Two, qualifiers): ``Draft.Notify``
  pushes each pack (1-based ``SelfPack`` / ``SelfPick``, comma-joined
  ``PackCards``, repeated up to three times) and ``==> EventPlayerDraftMakePick``
  names the pick (``GrpIds`` — two cards in Pick Two drafts).

Courses (``EventJoin`` / ``EventGetCoursesV2`` / ``DraftCompleteDraft``
responses) tie a draft to its event; ``DraftCompleteDraft`` also closes it
with the final card pool. Every write is an idempotent upsert keyed by
``(draft_id, pack_number, pick_number)``, so rescanning a log that the live
tracker already read adds nothing.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from .log_entry import LineBuffer
from .log_json import parse_json_from_body

# Cheap substring gate for the live loop: only these entries open the parser.
DRAFT_MARKERS = (
    "BotDraftDraft",
    "Draft.Notify",
    "EventPlayerDraftMakePick",
    "DraftCompleteDraft",
    "EventJoin",
    "EventGetCoursesV2",
)

_RESPONSE = re.compile(r"<==\s+(\w+)\(")
_REQUEST = re.compile(r"==>\s+(\w+)\s")
_DRAFT_MODULES = {"BotDraft", "PlayerDraft"}


def is_draft_entry(body: str) -> bool:
    return any(marker in body for marker in DRAFT_MARKERS)


def bot_draft_id(course_id: Optional[str], event_name: str, started: Optional[str]) -> str:
    """Stable id for a bot draft, which Arena never names: its course when
    known, else the event plus the first time the tracker saw it."""
    if course_id:
        return f"bot-{course_id}"
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"tapps:bot-draft:{event_name}:{started or ''}"))


def _iso(timestamp: Optional[datetime]) -> Optional[str]:
    if timestamp is None:
        return None
    if timestamp.tzinfo is None:
        timestamp = timestamp.astimezone()
    return timestamp.astimezone(timezone.utc).isoformat()


def _card_ids(values: Any) -> List[int]:
    """grpIds from a list of ints/strings or a comma-joined string."""
    if isinstance(values, str):
        values = values.split(",")
    if not isinstance(values, list):
        return []
    out = []
    for value in values:
        try:
            card = int(str(value).strip())
        except (TypeError, ValueError):
            continue
        if card > 0:
            out.append(card)
    return out


def _nested(value: Any, field: str) -> Any:
    """A field that Arena sometimes embeds as a JSON string."""
    if not isinstance(value, dict):
        return None
    inner = value.get(field)
    if isinstance(inner, str):
        try:
            return json.loads(inner)
        except ValueError:
            return None
    return inner


def ensure_draft_schema(conn) -> None:
    """Draft tables (migration 36). Idempotent."""
    conn.execute("""CREATE TABLE IF NOT EXISTS drafts (
               id TEXT PRIMARY KEY,
               kind TEXT NOT NULL,
               event_name TEXT,
               course_id TEXT,
               started_at TEXT,
               updated_at TEXT,
               completed_at TEXT,
               card_pool_json TEXT
           )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS draft_picks (
               draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
               pack_number INTEGER NOT NULL,
               pick_number INTEGER NOT NULL,
               pack_cards_json TEXT,
               picked_json TEXT,
               observed_at TEXT,
               PRIMARY KEY (draft_id, pack_number, pick_number)
           )""")
    conn.execute("CREATE INDEX IF NOT EXISTS drafts_started ON drafts(started_at)")


class DraftCapture:
    """Stateful reader: keep one instance per log stream (live tracker or rescan)."""

    def __init__(self, conn):
        self.conn = conn
        ensure_draft_schema(conn)
        self._last_time: Optional[str] = None
        # event name -> course id for courses currently in a draft module
        self._courses: Dict[str, str] = {}
        self._player_event: Optional[str] = None
        # event name -> bot draft id in progress
        self._bot_drafts: Dict[str, str] = {}
        self.touched: set = set()

    # -- entry dispatch -------------------------------------------------

    def consume(self, entry) -> Optional[str]:
        body = entry.body
        if entry.timestamp is not None:
            self._last_time = _iso(entry.timestamp)
        if not is_draft_entry(body):
            return None
        if "Draft.Notify" in body:
            return self._player_notify(parse_json_from_body(body.split("Draft.Notify", 1)[1]))
        response = _RESPONSE.search(body)
        request = _REQUEST.search(body)
        if response and (request is None or response.start() < request.start()):
            data = parse_json_from_body(body[response.end() :])
            return self._response(response.group(1), data)
        if request:
            data = parse_json_from_body(body[request.end() - 1 :])
            return self._request(request.group(1), _nested(data, "request"))
        return None

    def _response(self, name: str, data: Any) -> Optional[str]:
        if not isinstance(data, dict):
            return None
        if name in ("EventJoin", "EventGetCoursesV2"):
            courses = data.get("Courses") if name == "EventGetCoursesV2" else [data.get("Course")]
            for course in courses or []:
                self._note_course(course)
            return None
        if name in ("BotDraftDraftStatus", "BotDraftDraftPick"):
            return self._bot_status(_nested(data, "Payload"))
        if name == "DraftCompleteDraft":
            return self._complete(data)
        return None

    def _request(self, name: str, request: Any) -> Optional[str]:
        if not isinstance(request, dict):
            return None
        if name == "BotDraftDraftPick":
            info = request.get("PickInfo") or {}
            event = info.get("EventName") or request.get("EventName")
            draft_id = self._bot_drafts.get(event or "")
            if not draft_id:
                return None
            try:
                pack, pick = int(info["PackNumber"]) + 1, int(info["PickNumber"]) + 1
            except (KeyError, TypeError, ValueError):
                return None
            self._set_picked(draft_id, pack, pick, _card_ids(info.get("CardIds")))
            return draft_id
        if name == "EventPlayerDraftMakePick":
            draft_id = request.get("DraftId")
            if not isinstance(draft_id, str) or not draft_id:
                return None
            try:
                pack, pick = int(request["Pack"]), int(request["Pick"])
            except (KeyError, TypeError, ValueError):
                return None
            self._ensure_draft(draft_id, "player", self._player_event)
            self._set_picked(draft_id, pack, pick, _card_ids(request.get("GrpIds")))
            return draft_id
        return None

    # -- shapes ---------------------------------------------------------

    def _note_course(self, course: Any) -> None:
        if not isinstance(course, dict):
            return
        event, course_id = course.get("InternalEventName"), course.get("CourseId")
        if not isinstance(event, str) or not isinstance(course_id, str):
            return
        if course.get("CurrentModule") in _DRAFT_MODULES:
            self._courses[event] = course_id
            if course.get("CurrentModule") == "PlayerDraft":
                self._player_event = event

    def _bot_status(self, payload: Any) -> Optional[str]:
        if not isinstance(payload, dict):
            return None
        event = payload.get("EventName")
        if not isinstance(event, str) or not event:
            return None
        picked = _card_ids(payload.get("PickedCards"))
        draft_id = self._bot_drafts.get(event)
        if draft_id is None or (not picked and self._has_picks(draft_id)):
            # The first sight of a draft, or a new one (nothing picked) after an earlier run.
            draft_id = bot_draft_id(self._courses.get(event), event, self._last_time)
            self._bot_drafts[event] = draft_id
        self._ensure_draft(draft_id, "bot", event, self._courses.get(event))
        status = payload.get("DraftStatus")
        pack_cards = _card_ids(payload.get("DraftPack"))
        if pack_cards and status != "Completed":
            try:
                pack = int(payload["PackNumber"]) + 1
                pick = int(payload["PickNumber"]) + 1
            except (KeyError, TypeError, ValueError):
                return draft_id
            self._set_pack(draft_id, pack, pick, pack_cards)
        if status == "Completed":
            self._finish(draft_id, picked)
        return draft_id

    def _player_notify(self, data: Any) -> Optional[str]:
        if not isinstance(data, dict):
            return None
        draft_id = data.get("draftId")
        if not isinstance(draft_id, str) or not draft_id:
            return None
        try:
            pack, pick = int(data["SelfPack"]), int(data["SelfPick"])
        except (KeyError, TypeError, ValueError):
            return None
        cards = _card_ids(data.get("PackCards"))
        if not cards:
            return None
        self._ensure_draft(draft_id, "player", self._player_event)
        self._set_pack(draft_id, pack, pick, cards)
        return draft_id

    def _complete(self, data: Dict[str, Any]) -> Optional[str]:
        event = data.get("InternalEventName")
        course_id = data.get("CourseId")
        pool = _card_ids(data.get("CardPool"))
        draft_id = data.get("DraftId")
        if isinstance(draft_id, str) and draft_id:
            self._ensure_draft(draft_id, "player", event, course_id)
        elif isinstance(event, str) and event in self._bot_drafts:
            draft_id = self._bot_drafts[event]
        else:
            return None
        self.conn.execute(
            "UPDATE drafts SET event_name = COALESCE(?, event_name),"
            " course_id = COALESCE(?, course_id) WHERE id = ?",
            (event if isinstance(event, str) else None, course_id, draft_id),
        )
        self._finish(draft_id, pool)
        if isinstance(event, str):
            self._bot_drafts.pop(event, None)
            self._courses.pop(event, None)
        return draft_id

    # -- persistence ----------------------------------------------------

    def _has_picks(self, draft_id: str) -> bool:
        return (
            self.conn.execute(
                "SELECT 1 FROM draft_picks WHERE draft_id = ? AND picked_json IS NOT NULL LIMIT 1",
                (draft_id,),
            ).fetchone()
            is not None
        )

    def _ensure_draft(
        self, draft_id: str, kind: str, event: Optional[str], course_id: Optional[str] = None
    ) -> None:
        now = self._last_time
        self.conn.execute(
            """INSERT INTO drafts (id, kind, event_name, course_id, started_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                   event_name = COALESCE(drafts.event_name, excluded.event_name),
                   course_id = COALESCE(drafts.course_id, excluded.course_id),
                   started_at = COALESCE(drafts.started_at, excluded.started_at),
                   updated_at = COALESCE(drafts.updated_at, excluded.updated_at)""",
            (draft_id, kind, event, course_id, now, now),
        )
        self.touched.add(draft_id)

    def _set_pack(self, draft_id: str, pack: int, pick: int, cards: List[int]) -> None:
        self.conn.execute(
            """INSERT INTO draft_picks (draft_id, pack_number, pick_number, pack_cards_json, observed_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(draft_id, pack_number, pick_number) DO UPDATE SET
                   pack_cards_json = excluded.pack_cards_json,
                   observed_at = COALESCE(draft_picks.observed_at, excluded.observed_at)""",
            (draft_id, pack, pick, json.dumps(cards), self._last_time),
        )
        self.conn.commit()

    def _set_picked(self, draft_id: str, pack: int, pick: int, cards: List[int]) -> None:
        if not cards:
            return
        self.conn.execute(
            """INSERT INTO draft_picks (draft_id, pack_number, pick_number, picked_json, observed_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(draft_id, pack_number, pick_number) DO UPDATE SET
                   picked_json = excluded.picked_json""",
            (draft_id, pack, pick, json.dumps(cards), self._last_time),
        )
        self.conn.execute(
            "UPDATE drafts SET updated_at = COALESCE(?, updated_at) WHERE id = ?",
            (self._last_time, draft_id),
        )
        self.conn.commit()

    def _finish(self, draft_id: str, pool: List[int]) -> None:
        self.conn.execute(
            "UPDATE drafts SET completed_at = COALESCE(completed_at, ?),"
            " card_pool_json = COALESCE(?, card_pool_json) WHERE id = ?",
            (self._last_time, json.dumps(pool) if pool else None, draft_id),
        )
        self.conn.commit()


def _scan(capture: DraftCapture, log_path: Path) -> None:
    buffer = LineBuffer()

    def feed(entries: Iterable) -> None:
        for entry in entries:
            if entry.timestamp is not None or is_draft_entry(entry.body):
                capture.consume(entry)

    # Snapshot length bounds the scan if Arena keeps appending.
    size = log_path.stat().st_size
    with log_path.open("rb") as handle:
        remaining = size
        while remaining > 0:
            raw_line = handle.readline(min(remaining, 2_000_001))
            if not raw_line:
                break
            remaining -= len(raw_line)
            feed(buffer.push_line(raw_line.decode("utf-8", errors="replace")))
        feed(buffer.flush())


def capture_logs(conn, log_paths: Iterable[Path]) -> Dict[str, Any]:
    """Explicit rescan of Arena's logs (oldest first) for past drafts."""
    capture = DraftCapture(conn)
    scanned = []
    for path in log_paths:
        path = Path(path)
        if path.is_file():
            _scan(capture, path)
            scanned.append(path.name)
    return {"drafts": len(capture.touched), "logs": scanned}


def arena_log_paths(log_path: Path) -> List[Path]:
    """Arena keeps the previous session next to the current log as Player-prev.log."""
    log_path = Path(log_path)
    return [log_path.with_name("Player-prev.log"), log_path]
