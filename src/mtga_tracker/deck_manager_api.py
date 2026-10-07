"""Local dashboard endpoints for explicit deck-library actions."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from . import deck_manager as dm


def _read_connection(path):
    path = Path(path)
    if not path.is_file():
        return None
    conn = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'managed_decks'").fetchone():
        conn.close()
        return None
    return conn


def handle_get(path, query, db_path):
    if path not in ("/api/deck-manager", "/api/deck-manager/deck", "/api/deck-manager/export"):
        return None
    conn = None
    try:
        conn = _read_connection(db_path)
        if path == "/api/deck-manager":
            decks = dm.list_decks(conn) if conn else []
            for deck in decks:
                deck["tags"] = json.loads(deck.pop("tags_json"))
            return 200, {
                "decks": decks,
                "capabilities": {
                    "arena_transfers": False,
                    "native_section": False,
                    "capacity": None,
                    "message": "Deck backups and clipboard restore are available. Direct Arena transfers are not connected in this build.",
                },
            }
        if conn is None:
            raise KeyError("Saved deck not found.")
        detail = dm.deck_detail(conn, query.get("id", [""])[0], query.get("revision", [None])[0])
        detail["tags"] = json.loads(detail.pop("tags_json"))
        if path.endswith("/export"):
            fmt = query.get("format", ["backup"])[0]
            if fmt not in ("backup", "arena"):
                raise dm.DeckManagerError("Unknown export format.")
            return 200, {
                "text": (
                    dm.export_document(detail)
                    if fmt == "backup"
                    else dm.portable_text(detail["deck"])
                ),
                "name": detail["name"],
                "extension": ".tappsdeck" if fmt == "backup" else ".txt",
                "note": (
                    "This text export uses card names. Arena chooses printings and cosmetics; captured IDs and metadata remain in the full backup."
                    if fmt == "arena" and not detail["deck"].get("import_text")
                    else ""
                ),
            }
        return 200, detail
    except KeyError as exc:
        return 404, {"error": exc.args[0]}
    except dm.DeckManagerError as exc:
        return 400, {"error": str(exc)}
    except sqlite3.Error:
        return 500, {"error": "The deck library could not be read. Check the tracker data folder."}
    finally:
        if conn:
            conn.close()


def handle_post(path, payload, db_path):
    if path not in (
        "/api/deck-manager/import",
        "/api/deck-manager/update",
        "/api/deck-manager/delete",
        "/api/deck-manager/capture",
    ):
        return None
    if not isinstance(payload, dict):
        return 400, {"error": "Expected a JSON object."}
    conn = None
    try:
        if path.endswith("/delete"):
            deck_id = payload.get("id")
            if not isinstance(deck_id, str) or not deck_id.strip():
                raise dm.DeckManagerError("A saved deck ID is required.")
            if payload.get("confirm") != "DELETE":
                raise dm.DeckManagerError("Confirm permanent deletion of this deck and all its revisions.")
            conn = dm.library_connection(db_path)
            dm.delete_deck(conn, deck_id)
            return 200, {"ok": True}
        if path.endswith("/import"):
            text = payload.get("text")
            if not isinstance(text, str):
                raise dm.DeckManagerError("Paste an Arena decklist or choose a .tappsdeck backup.")
            for field in ("name", "format_name", "deck_id"):
                if payload.get(field) is not None and not isinstance(payload[field], str):
                    raise dm.DeckManagerError(f"Invalid {field}.")
            deck = dm.import_document(text, payload.get("name"), payload.get("format_name") or "")
            conn = dm.library_connection(db_path)
            return 200, dm.save_deck(conn, deck, deck_id=payload.get("deck_id"))
        if path.endswith("/update"):
            conn = dm.library_connection(db_path)
            deck_id = payload.get("id")
            if not isinstance(deck_id, str):
                raise dm.DeckManagerError("A saved deck ID is required.")
            dm.update_metadata(conn, deck_id, payload)
            return 200, {"ok": True}
        from .card_database import CardDatabase
        from .deck_capture import capture_log
        from .log_parser import MTGALogParser

        # No browser-supplied arbitrary path; reuse the resolved log and local DB.
        conn = dm.library_connection(db_path)
        selected_log = conn.execute(
            "SELECT log_path FROM live_status WHERE log_path IS NOT NULL LIMIT 1"
        ).fetchone()
        log = selected_log[0] if selected_log else MTGALogParser._find_log_path()
        cards = CardDatabase(log_path=log)
        return 200, capture_log(conn, Path(log), cards.get_card_name)
    except KeyError as exc:
        return 404, {"error": exc.args[0]}
    except (dm.DeckManagerError, FileNotFoundError, ValueError) as exc:
        return 400, {"error": str(exc)}
    except (OSError, sqlite3.Error):
        return 500, {
            "error": "The deck library could not be read or saved. Check the tracker data folder."
        }
    finally:
        if conn:
            conn.close()
