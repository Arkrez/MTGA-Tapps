"""Lossless local deck library. Arena mutations require a separate adapter."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

MAX_IMPORT_BYTES = 2_000_000
SECTIONS = {
    "deck": "Deck",
    "sideboard": "Sideboard",
    "commander": "Commander",
    "companion": "Companion",
    "maybeboard": "Maybeboard",
}


class DeckManagerError(ValueError):
    """A validation error that can be shown directly to the user."""


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def encoded(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def parse_import(text: str, name: Optional[str] = None, format_name: str = "") -> Dict[str, Any]:
    """Parse portable Arena text, retaining every printing and the original text."""
    if not isinstance(text, str) or len(text.encode("utf-8")) > MAX_IMPORT_BYTES:
        raise DeckManagerError("Deck import is too large or is not text.")
    cards = []
    section = "Deck"
    imported_name = ""
    saw_section = False
    for line_number, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line or line.lower() == "about":
            continue
        if line.lower().startswith("name "):
            imported_name = line[5:].strip()
            continue
        heading = SECTIONS.get(line.lower().rstrip(":"))
        if heading:
            section = heading
            saw_section = True
            continue
        match = re.fullmatch(r"(\d+)\s+(.+)", line)
        if not match or not 1 <= int(match[1]) <= 10_000:
            raise DeckManagerError(f"Unrecognized card or section on line {line_number}.")
        card_text = match[2]
        printing = re.fullmatch(r"(.+?)\s+\(([A-Za-z0-9]+)\)\s+(\d+[A-Za-z]?)", card_text)
        cards.append(
            {
                "section": section,
                "quantity": int(match[1]),
                "name": printing[1] if printing else card_text,
                "set_code": printing[2] if printing else None,
                "collector_number": printing[3] if printing else None,
                "arena_id": None,
            }
        )
    if (not cards and not saw_section) or sum(c["quantity"] for c in cards) > 50_000:
        raise DeckManagerError("The import must contain a decklist of at most 50,000 cards.")
    title = (name or imported_name or "Untitled deck").strip()
    if not title or len(title) > 256 or len(format_name) > 128:
        raise DeckManagerError("Deck name or format is too long.")
    return {
        "name": title,
        "format_name": format_name,
        "cards": cards,
        "import_text": text,
        "metadata": {},
        "source": "import",
        "completeness": "text",
    }


def content_hash(deck: Dict[str, Any]) -> str:
    """Hash exact piles and metadata, independent of JSON/list ordering."""
    cards = sorted(deck["cards"], key=encoded)
    payload = {
        "cards": cards,
        "metadata": deck.get("metadata", {}),
        "name": deck["name"],
        "format_name": deck.get("format_name", ""),
        "import_text": deck.get("import_text"),
        "completeness": deck.get("completeness", "text"),
    }
    return hashlib.sha256(encoded(payload).encode()).hexdigest()


def validate_deck(deck: Any) -> Dict[str, Any]:
    """Validate portable structured archives without resolving or dropping cards."""
    if not isinstance(deck, dict) or not isinstance(deck.get("name"), str):
        raise DeckManagerError("Invalid deck archive.")
    if not 1 <= len(deck["name"].strip()) <= 256:
        raise DeckManagerError("A deck name is required (maximum 256 characters).")
    cards = deck.get("cards")
    if not isinstance(cards, list) or len(cards) > 10_000:
        raise DeckManagerError("The archive has no valid decklist.")
    for card in cards:
        if not isinstance(card, dict) or card.get("section") not in SECTIONS.values():
            raise DeckManagerError("Invalid card section in archive.")
        quantity = card.get("quantity")
        if type(quantity) is not int or not 1 <= quantity <= 10_000:
            raise DeckManagerError("Invalid card quantity in archive.")
        if not isinstance(card.get("name"), str) or not card["name"].strip():
            raise DeckManagerError("Every card must retain a name or unresolved Arena ID label.")
        if card.get("arena_id") is not None and (
            type(card["arena_id"]) is not int or card["arena_id"] < 1
        ):
            raise DeckManagerError("Invalid Arena card ID.")
        for field in ("set_code", "collector_number"):
            if card.get(field) is not None and not isinstance(card[field], str):
                raise DeckManagerError("Invalid printing identifier.")
    if sum(c["quantity"] for c in cards) > 50_000:
        raise DeckManagerError("Decklist is too large.")
    if not isinstance(deck.get("import_text"), (str, type(None))):
        raise DeckManagerError("Invalid portable deck text.")
    if not isinstance(deck.get("metadata", {}), dict):
        raise DeckManagerError("Invalid deck metadata.")
    if not isinstance(deck.get("format_name", ""), str) or len(deck.get("format_name", "")) > 128:
        raise DeckManagerError("Invalid deck format.")
    if not isinstance(deck.get("source", "import"), str) or len(deck.get("source", "import")) > 80:
        raise DeckManagerError("Invalid deck source.")
    if deck.get("completeness", "text") not in ("text", "full", "main_only"):
        raise DeckManagerError("Invalid deck completeness.")
    if deck.get("import_text"):
        parsed = parse_import(deck["import_text"])

        def text_cards(items):
            return sorted(
                encoded(
                    {
                        key: c.get(key)
                        for key in ("section", "quantity", "name", "set_code", "collector_number")
                    }
                )
                for c in items
            )

        if text_cards(parsed["cards"]) != text_cards(cards):
            raise DeckManagerError("The portable text and saved card list disagree.")
    # Whitelist the portable fields. Never import executable instructions or bindings.
    result = {
        key: deck.get(key, default)
        for key, default in (
            ("name", ""),
            ("format_name", ""),
            ("cards", []),
            ("import_text", None),
            ("metadata", {}),
            ("source", "import"),
            ("completeness", "text"),
        )
    }
    if len(encoded(result).encode()) > MAX_IMPORT_BYTES:
        raise DeckManagerError("Deck archive is too large.")
    return result


def import_document(text: str, name: Optional[str] = None, format_name: str = "") -> Dict[str, Any]:
    if not isinstance(text, str) or len(text.encode("utf-8")) > MAX_IMPORT_BYTES:
        raise DeckManagerError("Deck import is too large or is not text.")
    if text.lstrip().startswith("{"):
        try:
            document = json.loads(text)
        except ValueError as exc:
            raise DeckManagerError("Invalid JSON deck archive.") from exc
        if document.get("format") != "tapps-deck" or document.get("version") != 1:
            raise DeckManagerError("Unsupported deck archive format or version.")
        deck = validate_deck(document.get("deck"))
        if name:
            deck["name"] = name
        if format_name:
            deck["format_name"] = format_name
        return validate_deck(deck)
    return parse_import(text, name, format_name)


def library_connection(path: Path) -> sqlite3.Connection:
    from .analytics import AnalyticsStore

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.execute("PRAGMA busy_timeout = 10000")
    AnalyticsStore.ensure_schema(conn)
    conn.row_factory = sqlite3.Row
    return conn


def save_deck(
    conn: sqlite3.Connection,
    deck: Dict[str, Any],
    *,
    deck_id: Optional[str] = None,
    account_key: Optional[str] = None,
    arena_deck_id: Optional[str] = None,
    observed_at: Optional[str] = None,
) -> Dict[str, Any]:
    from .analytics_persistence import persist_managed_deck

    return persist_managed_deck(
        conn,
        validate_deck(deck),
        deck_id=deck_id,
        account_key=account_key,
        arena_deck_id=arena_deck_id,
        observed_at=observed_at,
    )


def deck_detail(
    conn: sqlite3.Connection, deck_id: str, revision_id: Optional[str] = None
) -> Dict[str, Any]:
    cursor = conn.cursor()
    cursor.row_factory = sqlite3.Row
    row = cursor.execute("SELECT * FROM managed_decks WHERE id = ?", (deck_id,)).fetchone()
    if row is None:
        raise KeyError("Saved deck not found.")
    revision_id = revision_id or row["current_revision_id"]
    revision = cursor.execute(
        "SELECT * FROM managed_deck_revisions WHERE id = ? AND deck_id = ?", (revision_id, deck_id)
    ).fetchone()
    if revision is None:
        raise KeyError("Deck revision not found.")
    deck = json.loads(revision["payload_json"])
    revisions = [
        dict(r)
        for r in cursor.execute(
            "SELECT id, created_at, source, content_hash FROM managed_deck_revisions WHERE deck_id = ? ORDER BY created_at DESC, id",
            (deck_id,),
        )
    ]
    return {
        **dict(row),
        "deck": deck,
        "revision_id": revision_id,
        "revisions": revisions,
        "saved_at": revision["created_at"],
        "source": revision["source"],
        "completeness": revision["completeness"],
        "main_count": sum(c["quantity"] for c in deck["cards"] if c["section"] == "Deck"),
        "art_card": deck["cards"][0]["name"] if deck["cards"] else None,
    }


def list_decks(conn: sqlite3.Connection) -> list:
    cursor = conn.cursor()
    cursor.row_factory = sqlite3.Row
    # One grouped query; independent of the size of the saved library.
    return [
        dict(row)
        for row in cursor.execute(
            """
        SELECT d.*, r.source, r.completeness, r.created_at AS saved_at,
               COUNT(c.position) AS unique_cards,
               COALESCE(MAX(CASE WHEN c.section = 'Commander' THEN c.name END),
                        MAX(CASE WHEN c.position = 0 THEN c.name END)) AS art_card,
               SUM(CASE WHEN c.section = 'Deck' THEN c.quantity ELSE 0 END) AS main_count
        FROM managed_decks d JOIN managed_deck_revisions r ON r.id = d.current_revision_id
        LEFT JOIN managed_deck_cards c ON c.revision_id = r.id
        GROUP BY d.id ORDER BY d.name COLLATE NOCASE, d.id
    """
        )
    ]


def export_document(detail: Dict[str, Any]) -> str:
    return (
        json.dumps(
            {"format": "tapps-deck", "version": 1, "deck": detail["deck"]},
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )


def portable_text(deck: Dict[str, Any]) -> str:
    """Use original text when available; fail rather than invent unknown card names."""
    if deck.get("import_text"):
        return deck["import_text"]
    if any(c["name"].startswith("Card #") for c in deck["cards"]):
        raise DeckManagerError(
            "Some card names are unresolved. Download the full backup to preserve their Arena IDs."
        )
    lines = ["About", f"Name {deck['name']}"]
    for section in SECTIONS.values():
        cards = [c for c in deck["cards"] if c["section"] == section]
        if not cards and section != "Deck":
            continue
        lines.extend(["", section])
        for card in cards:
            printing = (
                f" ({card['set_code']}) {card['collector_number']}"
                if card.get("set_code") and card.get("collector_number")
                else ""
            )
            lines.append(f"{card['quantity']} {card['name']}{printing}")
    return "\n".join(lines)


def update_metadata(conn: sqlite3.Connection, deck_id: str, payload: Dict[str, Any]) -> None:
    if conn.execute("SELECT 1 FROM managed_decks WHERE id = ?", (deck_id,)).fetchone() is None:
        raise KeyError("Saved deck not found.")
    fields = {}
    if "notes" in payload:
        if not isinstance(payload["notes"], str) or len(payload["notes"]) > 20_000:
            raise DeckManagerError("Notes must be text, at most 20,000 characters.")
        fields["notes"] = payload["notes"]
    if "tags" in payload:
        tags = payload["tags"]
        if (
            not isinstance(tags, list)
            or len(tags) > 50
            or any(not isinstance(t, str) or len(t) > 80 for t in tags)
        ):
            raise DeckManagerError("Use at most 50 tags, each at most 80 characters.")
        fields["tags_json"] = encoded(sorted(set(t.strip() for t in tags if t.strip())))
    if "trashed" in payload:
        if type(payload["trashed"]) is not bool:
            raise DeckManagerError("Invalid trash action.")
        fields["trashed_at"] = now() if payload["trashed"] else None
    if not fields:
        return
    fields["updated_at"] = now()
    with conn:
        conn.execute(
            f"UPDATE managed_decks SET {', '.join(key + ' = ?' for key in fields)} WHERE id = ?",
            (*fields.values(), deck_id),
        )


def delete_deck(conn: sqlite3.Connection, deck_id: str) -> None:
    """Permanently remove a trashed archive and its children atomically."""
    with conn:
        # Take the write lock before checking Trash so a concurrent restore
        # cannot race deletion. This update leaves the archive metadata intact.
        locked = conn.execute(
            "UPDATE managed_decks SET id = id WHERE id = ? AND trashed_at IS NOT NULL",
            (deck_id,),
        )
        if not locked.rowcount:
            if not conn.execute("SELECT 1 FROM managed_decks WHERE id = ?", (deck_id,)).fetchone():
                raise KeyError("Saved deck not found.")
            raise DeckManagerError("Move this deck to Trash before deleting it permanently.")
        conn.execute(
            "DELETE FROM managed_deck_cards WHERE revision_id IN "
            "(SELECT id FROM managed_deck_revisions WHERE deck_id = ?)",
            (deck_id,),
        )
        conn.execute("DELETE FROM managed_deck_bindings WHERE deck_id = ?", (deck_id,))
        conn.execute("DELETE FROM managed_deck_revisions WHERE deck_id = ?", (deck_id,))
        conn.execute("DELETE FROM managed_decks WHERE id = ?", (deck_id,))


def merge_library(conn: sqlite3.Connection) -> Dict[str, int]:
    """Merge independent archives inside backup's existing transaction.

    Revision UUIDs are immutable. Union their contents; take newer library
    metadata, map equivalent revision IDs, and never restore Arena bindings.
    """
    if not conn.execute("SELECT 1 FROM src.sqlite_master WHERE name = 'managed_decks'").fetchone():
        return {"managed_decks": 0, "managed_deck_revisions": 0}
    previous_factory = conn.row_factory
    conn.row_factory = sqlite3.Row
    try:
        added_decks = added_revisions = 0
        incoming_decks = list(conn.execute("SELECT * FROM src.managed_decks"))
        for deck in incoming_decks:
            existing = conn.execute(
                "SELECT * FROM main.managed_decks WHERE id = ?", (deck["id"],)
            ).fetchone()
            if existing and existing["account_key"] != deck["account_key"]:
                raise DeckManagerError("Deck backup identity conflict between accounts.")
            if not existing:
                fields = list(deck.keys())
                conn.execute(
                    f"INSERT INTO main.managed_decks ({', '.join(fields)}) VALUES ({', '.join('?' for _ in fields)})",
                    tuple(deck),
                )
                added_decks += 1
        revision_map = {}
        inserted = []
        for revision in conn.execute(
            "SELECT * FROM src.managed_deck_revisions ORDER BY created_at, id"
        ).fetchall():
            payload = validate_deck(json.loads(revision["payload_json"]))
            if content_hash(payload) != revision["content_hash"]:
                raise DeckManagerError("A deck backup revision failed verification.")
            by_id = conn.execute(
                "SELECT deck_id, content_hash FROM main.managed_deck_revisions WHERE id = ?",
                (revision["id"],),
            ).fetchone()
            if by_id and (
                by_id["deck_id"] != revision["deck_id"]
                or by_id["content_hash"] != revision["content_hash"]
            ):
                raise DeckManagerError("A deck revision UUID has conflicting contents.")
            duplicate = conn.execute(
                "SELECT id FROM main.managed_deck_revisions WHERE deck_id = ? AND content_hash = ?",
                (revision["deck_id"], revision["content_hash"]),
            ).fetchone()
            if duplicate:
                revision_map[revision["id"]] = duplicate[0]
                continue
            revision_map[revision["id"]] = revision["id"]
            fields = list(revision.keys())
            conn.execute(
                f"INSERT INTO main.managed_deck_revisions ({', '.join(fields)}) VALUES ({', '.join('?' for _ in fields)})",
                tuple(revision),
            )
            conn.executemany(
                "INSERT INTO main.managed_deck_cards VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        revision["id"],
                        i,
                        c["section"],
                        c["quantity"],
                        c["name"],
                        c.get("arena_id"),
                        c.get("set_code"),
                        c.get("collector_number"),
                    )
                    for i, c in enumerate(payload["cards"])
                ],
            )
            inserted.append(revision)
            added_revisions += 1
        for revision in inserted:
            parent = revision["parent_revision_id"]
            if parent:
                if parent not in revision_map:
                    raise DeckManagerError("A deck backup is missing a parent revision.")
                conn.execute(
                    "UPDATE main.managed_deck_revisions SET parent_revision_id = ? WHERE id = ?",
                    (revision_map[parent], revision["id"]),
                )
        for deck in incoming_decks:
            current = conn.execute(
                "SELECT updated_at FROM main.managed_decks WHERE id = ?", (deck["id"],)
            ).fetchone()
            if deck["updated_at"] >= current[0]:
                revision_id = revision_map.get(deck["current_revision_id"])
                if not revision_id:
                    raise DeckManagerError("A deck backup is missing its current revision.")
                conn.execute(
                    "UPDATE main.managed_decks SET name = ?, format_name = ?, notes = ?, tags_json = ?, current_revision_id = ?, updated_at = ?, trashed_at = ? WHERE id = ?",
                    (
                        deck["name"],
                        deck["format_name"],
                        deck["notes"],
                        deck["tags_json"],
                        revision_id,
                        deck["updated_at"],
                        deck["trashed_at"],
                        deck["id"],
                    ),
                )
        return {"managed_decks": added_decks, "managed_deck_revisions": added_revisions}
    finally:
        conn.row_factory = previous_factory
