"""Capture complete submitted decklists independently of gameplay analytics."""

from __future__ import annotations

import json
import re
import uuid
from datetime import timezone
from pathlib import Path

from .deck_manager import DeckManagerError, validate_deck
from .log_entry import LineBuffer
from .log_json import parse_json_from_body

DECK_REQUEST = re.compile(r"==>\s+(DeckUpsertDeckV3|EventSetDeckV3)\b")
PILES = {
    "MainDeck": "Deck",
    "Sideboard": "Sideboard",
    "CommandZone": "Commander",
    "Companions": "Companion",
}


class DeckCapture:
    """Only deck-specific payloads enter the archive; outgoing saves stay unconfirmed."""

    def __init__(self, conn, name_resolver=None):
        self.conn = conn
        self.name_resolver = name_resolver or (lambda arena_id: f"Card #{arena_id}")

    def consume(self, entry):
        marker = DECK_REQUEST.search(entry.body)
        if marker is None:
            return None
        data = parse_json_from_body(entry.body)
        if not isinstance(data, dict):
            return None
        payload = data.get("request", data)
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except ValueError:
                return None
        if not isinstance(payload, dict):
            return None
        summary, raw = payload.get("Summary"), payload.get("Deck")
        if (
            not isinstance(summary, dict)
            or not isinstance(raw, dict)
            or not isinstance(raw.get("MainDeck"), list)
        ):
            return None
        arena_id = summary.get("DeckId")
        if not isinstance(arena_id, str) or not arena_id:
            return None
        cards = []
        for pile, section in PILES.items():
            entries = raw.get(pile, [])
            if not isinstance(entries, list):
                raise DeckManagerError("Malformed Arena deck pile; nothing was archived.")
            for card in entries:
                if not isinstance(card, dict):
                    raise DeckManagerError("Malformed Arena card; nothing was archived.")
                card_id, quantity = card.get("cardId"), card.get("quantity")
                if (
                    type(card_id) is not int
                    or card_id < 1
                    or type(quantity) is not int
                    or quantity < 1
                ):
                    raise DeckManagerError(
                        "Malformed Arena card quantity or ID; nothing was archived."
                    )
                name = self.name_resolver(card_id)
                if not name or name.startswith("Unknown Card"):
                    name = f"Card #{card_id}"
                cards.append(
                    {
                        "section": section,
                        "quantity": quantity,
                        "arena_id": card_id,
                        "name": name,
                        "set_code": None,
                        "collector_number": None,
                    }
                )
        attributes = summary.get("Attributes", [])
        fmt = (
            next(
                (
                    a.get("value", "")
                    for a in attributes
                    if isinstance(a, dict) and a.get("name") == "Format"
                ),
                "",
            )
            if isinstance(attributes, list)
            else ""
        )
        deck = {
            "name": summary.get("Name") or "Untitled deck",
            "format_name": fmt,
            "cards": cards,
            "import_text": None,
            "source": (
                "arena_save_request"
                if marker[1] == "DeckUpsertDeckV3"
                else "arena_event_submission"
            ),
            "completeness": "full" if all(p in raw for p in PILES) else "main_only",
            "metadata": {"arena_deck_id": arena_id, "summary": summary, "deck": raw},
        }
        # GUID identity groups revisions without making any account/presence claim.
        # No server bindings are written until a real authenticated adapter exists.
        local_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "tapps:unassigned-arena-deck:" + arena_id))
        from .analytics_persistence import persist_managed_deck

        observed_at = (
            entry.timestamp.astimezone(timezone.utc).isoformat() if entry.timestamp else None
        )
        persist_managed_deck(
            self.conn, validate_deck(deck), deck_id=local_id, create=True, observed_at=observed_at
        )
        return local_id


def capture_log(conn, log_path: Path, name_resolver=None):
    """Explicit bounded rescan, using the existing multiline entry buffer."""
    buffer = LineBuffer()
    capture = DeckCapture(conn, name_resolver)
    captured = set()
    failures = 0

    def consume(entry):
        nonlocal failures
        try:
            deck_id = capture.consume(entry)
            if deck_id:
                captured.add(deck_id)
        except (DeckManagerError, ValueError, TypeError):
            failures += 1

    # Snapshot length bounds this job if Arena continues appending.
    size = Path(log_path).stat().st_size
    with Path(log_path).open("rb") as handle:
        remaining = size
        while remaining > 0:
            raw_line = handle.readline(min(remaining, 2_000_001))
            if not raw_line:
                break
            remaining -= len(raw_line)
            for entry in buffer.push_line(raw_line.decode("utf-8", errors="replace")):
                consume(entry)
        for entry in buffer.flush():
            consume(entry)
    return {
        "captured": len(captured),
        "rejected": failures,
        "note": "Only full lists present in this log were captured. Other Arena decks may need to be exported or saved first.",
    }
