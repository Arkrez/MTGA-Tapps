"""Background native deck jobs. GET never attaches to Arena."""

from __future__ import annotations

from pathlib import Path
import sqlite3
import threading
import time
import uuid

from . import deck_manager as dm
from . import deck_transfers as dt
from . import native_deck_bridge as nb

_LOCK = threading.Lock()
_JOBS = {}
_STATUS = {}
_ACTIVE = None


def _key(db_path):
    return str(Path(db_path).resolve())


def game_in_progress(db_path):
    path = Path(db_path)
    if not path.is_file():
        return False
    conn = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=10)
    try:
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE name='live_status'").fetchone():
            return False
        row = conn.execute("SELECT in_game FROM live_status WHERE id=1").fetchone()
        return bool(row and row[0])
    finally:
        conn.close()


def status(db_path):
    available, message = nb.availability()
    with _LOCK:
        result = dict(_STATUS.get(_key(db_path), {}))
        active = _ACTIVE if _ACTIVE and _JOBS[_ACTIVE]["db"] == _key(db_path) else None
    account = result.pop("_account_key", None)
    pending = []
    path = Path(db_path)
    if path.is_file():
        conn = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=10)
        try:
            if conn.execute(
                "SELECT 1 FROM sqlite_master WHERE name='managed_deck_transfers'"
            ).fetchone():
                pending = [
                    {"id": r[0], "action": r[1], "phase": r[2], "deck_id": r[3]}
                    for r in conn.execute(
                        "SELECT id,action,phase,deck_id FROM managed_deck_transfers "
                        "WHERE phase NOT IN ('complete','cancelled')"
                        + (" AND account_key=?" if account else ""),
                        (account,) if account else (),
                    )
                ]
        finally:
            conn.close()
    return {
        "available": available,
        "connected": False,
        "decks": [],
        "limit": None,
        "limit_reached": None,
        "deck_screen_open": False,
        "message": message,
        **result,
        "busy": active is not None,
        "active_job": active,
        "pending_transfers": pending,
        "in_game": game_in_progress(db_path),
    }


def _public_roster(report):
    dt.roster_ids(report)
    return {
        "connected": True,
        "decks": [
            {
                "id": d["arena_id"],
                "name": d["name"],
                "format_name": next(
                    (
                        a["value"]
                        for a in d["summary"].get("Attributes", [])
                        if a["key"] == "Format"
                    ),
                    "",
                ),
                "main_count": sum(
                    c["quantity"]
                    for p in d.get("piles", [])
                    if p["pile"] == 1
                    for c in p["entries"]
                ),
            }
            for d in report["decks"]
        ],
        "limit": report["limit"],
        "limit_reached": report["limit_reached"],
        "deck_screen_open": report["deck_screen_open"],
        "refreshed_at": dm.now(),
        "message": "Arena roster refreshed. Transfers require the Decks screen outside a match.",
    }


def _resolve_names():
    from .card_database import CardDatabase

    try:
        return CardDatabase().get_card_name
    except Exception:
        return None


def execute(db_path, action, selections, request_id, progress):
    """Every job uses a fresh native/account connection and this selected DB."""
    if game_in_progress(db_path):
        raise dm.DeckManagerError(
            "Finish your current game before connecting Deck Manager to Arena."
        )
    conn = dm.library_connection(db_path)
    try:
        with nb.attach() as bridge:
            progress("Reading Arena’s current decks…")
            report = bridge.roster()
            dt.roster_ids(report)
            if action == "reconcile":
                report = dt.reconcile(conn, bridge, report)
            elif action == "backup":
                if report.get("deck_screen_open") is not True:
                    raise dm.DeckManagerError(
                        "Open Arena’s Decks screen outside a match to back up decks."
                    )
                ids = [s["id"] for s in selections] if selections else dt.roster_ids(report)
                if not set(ids) <= set(dt.roster_ids(report)):
                    raise dm.DeckManagerError(
                        "A selected deck is no longer in Arena. Refresh the list."
                    )
                progress(f"Backing up {len(ids)} deck{'s' if len(ids) != 1 else ''}…")
                archives = bridge.archive(ids)
                if (
                    len(archives) != len(ids)
                    or [a["source_snapshot"]["arena_id"] for a in archives] != ids
                ):
                    raise dm.DeckManagerError("Arena returned a different backup selection.")
                # Validate every returned archive before publishing the batch.
                from .native_deck_archive import validate_archive

                for archive in archives:
                    validate_archive(archive)
                resolver = _resolve_names()
                for archive in archives:
                    saved = dt.persist_archive(conn, archive, bridge.account_key, resolver)
                    dt.set_presence(
                        conn,
                        bridge.account_key,
                        archive["source_snapshot"]["arena_id"],
                        saved["id"],
                        "present",
                    )
            elif action in ("store", "restore"):
                resolver = _resolve_names()
                for i, selection in enumerate(selections):
                    if game_in_progress(db_path):
                        raise dm.DeckManagerError(
                            "Arena entered a game. Remaining decks were not transferred."
                        )
                    progress(
                        f"{'Moving to collection' if action == 'store' else 'Restoring to Arena'}: "
                        f"{i + 1} of {len(selections)}…"
                    )
                    report = dt.transfer(
                        conn, bridge, action, selection, request_id, report, resolver
                    )
                    # Publish completed progress even if the next deck fails.
                    with _LOCK:
                        _STATUS[_key(db_path)] = {
                            **_public_roster(report),
                            "_account_key": bridge.account_key,
                        }
            elif action != "connect":
                raise dm.DeckManagerError("Unknown native deck action.")
            current = _public_roster(report)
            current["_account_key"] = bridge.account_key
            current["pending_transfers"] = [
                {"id": r["id"], "action": r["action"], "phase": r["phase"], "deck_id": r["deck_id"]}
                for r in dt.pending(conn, bridge.account_key)
            ]
            with _LOCK:
                _STATUS[_key(db_path)] = current
            count = len(selections) or (len(report["decks"]) if action == "backup" else 0)
            return {"count": count, "action": action}
    finally:
        conn.close()


def start(db_path, payload):
    global _ACTIVE
    action = payload.get("action")
    if action not in ("connect", "backup", "store", "restore", "reconcile"):
        raise dm.DeckManagerError("Choose a native deck action.")
    request_id = str(uuid.UUID(payload.get("request_id", "")))
    selections = payload.get("decks", [])
    if not isinstance(selections, list) or len(selections) > 2000:
        raise dm.DeckManagerError("Invalid deck selection.")
    clean = []
    for item in selections:
        if not isinstance(item, dict):
            raise dm.DeckManagerError("Invalid selected deck.")
        row = {"id": str(uuid.UUID(item.get("id", "")))}
        if item.get("revision"):
            row["revision"] = str(uuid.UUID(item["revision"]))
        clean.append(row)
    if len({d["id"] for d in clean}) != len(clean) or (
        action in ("store", "restore") and not clean
    ):
        raise dm.DeckManagerError("Select at least one distinct deck.")
    if action == "store" and payload.get("confirm") != "MOVE":
        raise dm.DeckManagerError(
            "Confirm moving the selected decks out of Arena after verified backup."
        )
    with _LOCK:
        if request_id in _JOBS:
            existing = _JOBS[request_id]
            if (
                existing["db"] != _key(db_path)
                or existing["action"] != action
                or existing["selections"] != clean
            ):
                raise dm.DeckManagerError("This request ID was already used for another action.")
            return request_id
        if _ACTIVE:
            raise dm.DeckManagerError("Wait for the current Arena deck operation to finish.")
        for key in list(_JOBS):
            if _JOBS[key]["state"] != "running" and time.monotonic() - _JOBS[key]["created"] > 3600:
                del _JOBS[key]
        _ACTIVE = request_id
        _JOBS[request_id] = {
            "db": _key(db_path),
            "action": action,
            "selections": clean,
            "state": "running",
            "detail": "Connecting to Arena…",
            "created": time.monotonic(),
        }

    def progress(message):
        with _LOCK:
            _JOBS[request_id]["detail"] = message

    def run():
        global _ACTIVE
        try:
            result = execute(db_path, action, clean, request_id, progress)
            with _LOCK:
                _JOBS[request_id].update(state="done", detail="Completed.", result=result)
        except Exception as exc:
            # Native exception messages contain no deck data or credentials.
            message = (
                str(exc)
                if isinstance(exc, (dm.DeckManagerError, ValueError, KeyError))
                else "Arena could not complete this operation. "
                "Refresh and reconcile before repeating a transfer."
            )
            with _LOCK:
                _JOBS[request_id].update(state="error", detail=message)
        finally:
            with _LOCK:
                _ACTIVE = None

    threading.Thread(target=run, name="arena-deck-manager", daemon=True).start()
    return request_id


def handle_get(path, query, db_path):
    if path == "/api/deck-manager/native":
        return 200, status(db_path)
    if path == "/api/deck-manager/native/job":
        with _LOCK:
            job = dict(_JOBS.get(query.get("id", [""])[0], {}))
        if not job or job.pop("db") != _key(db_path):
            return 404, {
                "error": "Deck operation not found. Refresh and reconcile if the tracker restarted."
            }
        job.pop("created", None)
        job.pop("selections", None)
        return 200, job
    return None


def handle_post(path, payload, db_path):
    if path != "/api/deck-manager/native/run":
        return None
    try:
        if not isinstance(payload, dict):
            raise dm.DeckManagerError("Expected a deck action.")
        return 202, {"job_id": start(db_path, payload)}
    except (ValueError, TypeError, AttributeError) as exc:
        return 400, {
            "error": (
                str(exc)
                if isinstance(exc, dm.DeckManagerError)
                else "Invalid deck operation or identity."
            )
        }
