"""Native transfer boundaries with a fake Arena; never attach to a game."""

from contextlib import contextmanager
import copy
import json
import uuid

import pytest

from mtga_tracker import deck_manager as dm, deck_transfers as dt, deck_native_api as api
from mtga_tracker import native_deck_archive as na


def deck():
    identity = str(uuid.uuid4())
    return {
        "arena_id": identity,
        "name": "Offline native fixture",
        "is_net_deck": False,
        "contents_loaded": True,
        "summary": {
            "DeckId": identity,
            "Name": "Offline native fixture",
            "Description": "",
            "Attributes": [{"key": "Format", "value": "Standard"}],
        },
        "piles": [
            {"pile": 1, "entries": [{"id": 123, "quantity": 60}]},
            {"pile": 2, "entries": []},
            {"pile": 3, "entries": []},
            {"pile": 4, "entries": []},
        ],
        "skins": [{"GrpId": "9007199254740993", "CCV": "style", "ArtId": "456"}],
    }


def archive(snapshot):
    return {
        "schema": 1,
        "archive_kind": "arena_typed_model_poc",
        "source_snapshot": copy.deepcopy(snapshot),
        "pile_names": {"1": "Main", "2": "Sideboard", "3": "CommandZone", "4": "Companions"},
        "model_json": '{"style":9007199254740993}',
        "summary_json": json.dumps(snapshot["summary"]),
    }


class Arena:
    account_key = "fixture-account"

    def __init__(self):
        self.source = deck()
        self.decks = {self.source["arena_id"]: self.source}
        self.calls = []
        self.full = False
        self.on_decks = True
        self.after_write = None

    def roster(self):
        return {
            "roster_refreshed": True,
            "decks": copy.deepcopy(list(self.decks.values())),
            "limit": 100,
            "limit_reached": self.full,
            "deck_screen_open": self.on_decks,
        }

    def archive(self, ids):
        self.calls.append("archive")
        return [archive(self.decks[i]) for i in ids]

    def fetch(self, identity):
        self.calls.append("fetch")
        return copy.deepcopy(self.decks[identity])

    def remove(self, snapshot):
        self.calls.append("remove")
        del self.decks[snapshot["arena_id"]]
        if self.after_write:
            self.after_write()

    def create(self, saved, identity):
        self.calls.append("create")
        restored = copy.deepcopy(saved["source_snapshot"])
        restored["arena_id"] = restored["summary"]["DeckId"] = identity
        self.decks[identity] = restored
        if self.after_write:
            self.after_write()
        return copy.deepcopy(restored)


@pytest.fixture
def conn(tmp_path):
    connection = dm.library_connection(tmp_path / "tracker.db")
    yield connection
    connection.close()


def store(conn, arena, request_id=None):
    return dt.transfer(
        conn,
        arena,
        "store",
        {"id": arena.source["arena_id"]},
        request_id or str(uuid.uuid4()),
        arena.roster(),
        lambda _: "Forest",
    )


def saved(conn):
    return dm.deck_detail(conn, dm.list_decks(conn)[0]["id"])


def restore(conn, arena, request_id=None):
    return dt.transfer(
        conn,
        arena,
        "restore",
        {"id": saved(conn)["id"]},
        request_id or str(uuid.uuid4()),
        arena.roster(),
    )


def test_store_commits_complete_read_back_archive_and_intent_before_remove(conn):
    arena = Arena()
    remove = arena.remove

    def checked(snapshot):
        detail = saved(conn)
        assert na.equivalent(
            detail["deck"]["metadata"]["native_archive"]["source_snapshot"], snapshot
        )
        assert dt.pending(conn)[0]["phase"] == "write_started"
        assert conn.execute("SELECT COUNT(*) FROM games").fetchone()[0] == 0
        remove(snapshot)

    arena.remove = checked
    store(conn, arena)
    assert arena.decks == {}
    assert dt.pending(conn) == []
    assert conn.execute("SELECT presence FROM managed_deck_bindings").fetchone()[0] == "absent"
    assert saved(conn)["deck"]["cards"][0]["name"] == "Forest"
    assert (
        json.loads(saved(conn)["deck"]["metadata"]["native_archive"]["model_json"])["style"]
        == 9007199254740993
    )


def test_restore_uses_saved_archive_and_new_identity_without_clipboard(conn):
    arena = Arena()
    store(conn, arena)
    restore(conn, arena)
    assert len(arena.decks) == 1
    identity, actual = next(iter(arena.decks.items()))
    assert identity != arena.source["arena_id"]
    assert na.equivalent(actual, arena.source, restored_id=identity)
    assert arena.calls.count("create") == 1
    assert dt.pending(conn) == []


def test_disk_failure_prevents_original_deletion(conn, monkeypatch):
    arena = Arena()

    def fail(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(dm, "save_deck", fail)
    with pytest.raises(OSError):
        store(conn, arena)
    assert "remove" not in arena.calls
    assert arena.source["arena_id"] in arena.decks


def test_external_edit_after_backup_prevents_deletion(conn):
    arena = Arena()
    fetch = arena.fetch

    def changed(identity):
        result = fetch(identity)
        result["piles"][0]["entries"][0]["quantity"] = 59
        return result

    arena.fetch = changed
    with pytest.raises(dm.DeckManagerError, match="changed"):
        store(conn, arena)
    assert "remove" not in arena.calls
    assert saved(conn)["deck"]["cards"][0]["quantity"] == 60


@pytest.mark.parametrize("failure", ["capacity", "account", "duplicate", "screen"])
def test_restore_guards_prevent_native_create(conn, failure):
    arena = Arena()
    store(conn, arena)
    if failure == "capacity":
        arena.full = True
    elif failure == "account":
        arena.account_key = "another-account"
    elif failure == "duplicate":
        arena.decks[arena.source["arena_id"]] = arena.source
    else:
        arena.on_decks = False
    with pytest.raises(dm.DeckManagerError):
        restore(conn, arena)
    assert "create" not in arena.calls


def test_interrupted_removal_reconciles_read_only_after_commit(conn):
    arena = Arena()

    def disconnect():
        raise TimeoutError("connection lost")

    arena.after_write = disconnect
    with pytest.raises(TimeoutError):
        store(conn, arena)
    assert dt.pending(conn)[0]["phase"] == "uncertain"
    calls = list(arena.calls)
    dt.reconcile(conn, arena, arena.roster())
    assert arena.calls == calls
    assert dt.pending(conn) == []


def test_interrupted_restore_reconciles_after_commit_without_second_creation(conn):
    arena = Arena()
    store(conn, arena)

    def disconnect():
        raise TimeoutError("connection lost")

    arena.after_write = disconnect
    with pytest.raises(TimeoutError):
        restore(conn, arena)
    assert dt.pending(conn)[0]["action"] == "restore"
    dt.reconcile(conn, arena, arena.roster())
    assert arena.calls.count("create") == 1
    assert dt.pending(conn) == []


def test_unknown_restore_absence_does_not_allow_create_retry(conn):
    arena = Arena()
    store(conn, arena)

    def disconnected(*args):
        arena.calls.append("create")
        raise TimeoutError("unknown")

    arena.create = disconnected
    request_id = str(uuid.uuid4())
    with pytest.raises(TimeoutError):
        restore(conn, arena, request_id)
    with pytest.raises(dm.DeckManagerError, match="not confirmed"):
        dt.reconcile(conn, arena, arena.roster())
    with pytest.raises(dm.DeckManagerError, match="already started"):
        restore(conn, arena, request_id)
    assert arena.calls.count("create") == 1


def test_completed_request_replay_is_idempotent(conn):
    arena = Arena()
    request_id = str(uuid.uuid4())
    store(conn, arena, request_id)
    calls = list(arena.calls)
    store(conn, arena, request_id)
    assert arena.calls == calls


def test_completed_request_cannot_be_replayed_for_a_different_account(conn):
    arena = Arena()
    request_id = str(uuid.uuid4())
    store(conn, arena, request_id)
    arena.account_key = "another-account"
    with pytest.raises(dm.DeckManagerError, match="another account"):
        store(conn, arena, request_id)
    assert arena.calls.count("remove") == 1


def test_pending_transfer_blocks_local_permanent_deletion(conn):
    arena = Arena()

    def fail(*args):
        raise TimeoutError("unknown")

    arena.remove = fail
    with pytest.raises(TimeoutError):
        store(conn, arena)
    detail = saved(conn)
    dm.update_metadata(conn, detail["id"], {"trashed": True})
    with pytest.raises(dm.DeckManagerError, match="Reconcile"):
        dm.delete_deck(conn, detail["id"])
    other = dm.save_deck(conn, dm.parse_import("Deck\n4 Forest"))
    dm.update_metadata(conn, other["id"], {"trashed": True})
    with pytest.raises(dm.DeckManagerError, match="Reconcile"):
        dm.remove_decks(conn, [other["id"], detail["id"]], "delete")
    assert dm.deck_detail(conn, other["id"])
    assert saved(conn)


def test_missing_other_deck_keeps_transfer_unresolved(conn):
    arena = Arena()
    other = deck()
    arena.decks[other["arena_id"]] = other
    arena.after_write = lambda: arena.decks.pop(other["arena_id"])
    with pytest.raises(dm.DeckManagerError, match="Other Arena decks"):
        store(conn, arena)
    assert dt.pending(conn)


def test_status_get_never_attaches_or_creates_database(tmp_path, monkeypatch):
    def forbidden():
        raise AssertionError("GET must not attach")

    monkeypatch.setattr(api.nb, "attach", forbidden)
    path = tmp_path / "missing.db"
    assert api.handle_get("/api/deck-manager/native", {}, path)[0] == 200
    assert not path.exists()


def test_background_bulk_backup_reads_actual_roster_without_deletes(tmp_path, monkeypatch):
    arena = Arena()
    arena.decks[deck()["arena_id"]] = deck()
    # Rebuild keys to reflect fixture IDs.
    arena.decks = {d["arena_id"]: d for d in arena.decks.values()}

    @contextmanager
    def attach():
        yield arena

    monkeypatch.setattr(api.nb, "attach", attach)
    monkeypatch.setattr(api, "_resolve_names", lambda: lambda _: "Forest")
    path = tmp_path / "library.db"
    result = api.execute(path, "backup", [], str(uuid.uuid4()), lambda _: None)
    assert result["count"] == 2
    assert arena.calls == ["archive"]
    with dm.library_connection(path) as conn:
        assert len(dm.list_decks(conn)) == 2
        assert conn.execute("SELECT COUNT(*) FROM games").fetchone()[0] == 0


def test_native_move_endpoint_requires_confirmation_before_starting_job(tmp_path):
    status, _ = api.handle_post(
        "/api/deck-manager/native/run",
        {"action": "store", "decks": [{"id": str(uuid.uuid4())}], "request_id": str(uuid.uuid4())},
        tmp_path / "db",
    )
    assert status == 400


@pytest.mark.parametrize("payload", [{"$type": "Arbitrary"}, {"nested": [{"$type": "Arbitrary"}]}])
def test_native_archive_refuses_arbitrary_deserialization_types(payload):
    value = archive(deck())
    value["model_json"] = json.dumps(payload)
    with pytest.raises(dm.DeckManagerError, match="executable"):
        na.validate_archive(value)


def test_portable_native_backup_restores_only_on_its_original_account(conn):
    arena = Arena()
    store(conn, arena)
    portable = dm.import_document(dm.export_document(saved(conn)))
    imported = dm.save_deck(conn, portable)
    dt.transfer(conn, arena, "restore", {"id": imported["id"]}, str(uuid.uuid4()), arena.roster())
    assert len(arena.decks) == 1
    assert arena.calls.count("create") == 1


def test_edited_card_list_cannot_silently_restore_stale_native_data(conn):
    arena = Arena()
    store(conn, arena)
    original = saved(conn)
    changed = copy.deepcopy(original["deck"])
    changed["cards"][0]["quantity"] = 59
    dm.save_deck(conn, changed, deck_id=original["id"])
    with pytest.raises(dm.DeckManagerError, match="differs from its native backup"):
        restore(conn, arena)
    assert "create" not in arena.calls


def test_tracked_game_blocks_attachment_before_any_native_call(tmp_path, monkeypatch):
    path = tmp_path / "tracker.db"
    with dm.library_connection(path) as conn:
        conn.execute("INSERT INTO live_status(id,in_game,updated_at) VALUES(1,1,?)", (dm.now(),))

    def forbidden():
        raise AssertionError("Do not attach during a tracked game")

    monkeypatch.setattr(api.nb, "attach", forbidden)
    with pytest.raises(dm.DeckManagerError, match="Finish your current game"):
        api.execute(path, "connect", [], str(uuid.uuid4()), lambda _: None)
    assert api.status(path)["in_game"] is True
