"""Explicit, bounded attachment to Arena's native deck services."""

from __future__ import annotations

from contextlib import contextmanager
import hashlib
from pathlib import Path
from threading import Timer

from .deck_manager import DeckManagerError
from .paths import native_deck_platform_supported


def availability():
    if not native_deck_platform_supported():
        return False, "Direct transfers currently support Apple Silicon Arena on macOS."
    try:
        import frida  # noqa: F401
    except ImportError:
        return False, "The native deck adapter is missing from this installation."
    return True, "Open Arena’s Decks screen, then load its decks."


def account_key(account_id):
    if not isinstance(account_id, str) or not account_id or len(account_id) > 256:
        raise DeckManagerError("Arena account identity is unavailable.")
    return hashlib.sha256(("tapps-arena-account:" + account_id).encode()).hexdigest()


class ArenaBridge:
    def __init__(self, exports):
        self.exports = exports
        self.info = exports.open()
        self.account_id = self.info["account_id"]
        self.account_key = account_key(self.account_id)

    def roster(self):
        report = self.exports.roster(self.account_id)
        if (
            report.get("account_id") != self.account_id
            or report.get("roster_refreshed") is not True
        ):
            raise DeckManagerError("Arena account changed or roster refresh failed.")
        return report

    def archive(self, ids):
        return self.exports.archive(self.account_id, ids)

    def fetch(self, arena_id):
        return self.exports.fetchdeck(self.account_id, arena_id)

    def create(self, archive, arena_id):
        return self.exports.create(self.account_id, archive, arena_id)

    def prepare_create(self, archive, arena_id):
        try:
            return self.exports.preparecreate(self.account_id, archive, arena_id)
        except Exception as exc:
            raise DeckManagerError(
                "Arena could not prepare this backup. No deck was created; your saved deck remains."
            ) from exc

    def create_prepared(self, arena_id):
        return self.exports.createprepared(self.account_id, arena_id)

    def prepare_import(self, text, name, arena_id):
        return self.exports.prepareimport(self.account_id, text, name, arena_id)

    def remove(self, snapshot):
        return self.exports.remove(self.account_id, snapshot)


@contextmanager
def attach():
    available, message = availability()
    if not available:
        raise DeckManagerError(message)
    import frida

    device = frida.get_local_device()
    processes = [p for p in device.enumerate_processes() if p.name == "MTGA"]
    if len(processes) != 1:
        raise DeckManagerError("Open Arena and return to Decks outside a match.")
    session = device.attach(processes[0].pid)
    # Each explicit job attaches independently, never launches/restarts Arena.
    timer = Timer(600, session.detach)
    timer.daemon = True
    script = None
    try:
        timer.start()
        script = session.create_script(
            (Path(__file__).parent / "assets" / "arena_decks.js").read_text()
        )
        script.load()
        bridge = ArenaBridge(script.exports_sync)
        yield bridge
    finally:
        if script:
            try:
                script.exports_sync.close()
            except Exception:
                pass
        timer.cancel()
        try:
            session.detach()
        except Exception:
            pass
