"""Offline boundaries for the explicit native experiment; never attach to Arena."""

import copy
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace
import uuid

import pytest

from mtga_tracker import deck_manager as dm

POC = Path(__file__).resolve().parents[1] / "deck-manager-bridge" / "poc"


def load(name):
    spec = importlib.util.spec_from_file_location(f"native_poc_{name}", POC / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(POC))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(POC))
    return module


capture = load("capture")
runner = load("run")
disposable = load("disposable_copy")


def snapshot():
    arena_id = str(uuid.uuid4())
    deck = {
        "name": "Same name",
        "arena_id": arena_id,
        "is_net_deck": False,
        "contents_loaded": True,
        "summary": {
            "DeckId": arena_id,
            "Name": "Same name",
            "Attributes": [{"key": "Format", "value": "HistoricBrawl"}],
            "DeckArtId": 987,
            "NetDeckFolderId": {"raw_bytes": [0] * 20},
        },
        "piles": [
            {"pile": 1, "entries": [{"id": 123, "quantity": 98}]},
            {"pile": 2, "entries": [{"id": 456, "quantity": 1}]},
            {"pile": 3, "entries": [{"id": 789, "quantity": 1}]},
            {"pile": 4, "entries": [{"id": 111, "quantity": 1}]},
        ],
        "skins": [{"GrpId": "123", "CCV": "style", "ArtId": "987"}],
    }
    return {
        "schema": 1,
        "runtime": "IL2CPP",
        "unity_thread_observed": True,
        "pile_names": {"1": "Main", "2": "Sideboard", "3": "CommandZone", "4": "Companions"},
        "decks": [deck],
    }


def test_bulk_capture_preserves_piles_printing_ids_and_raw_metadata(tmp_path):
    report = snapshot()
    second = copy.deepcopy(report["decks"][0])
    second["arena_id"] = second["summary"]["DeckId"] = str(uuid.uuid4())
    report["decks"].append(second)
    net = copy.deepcopy(second)
    net["is_net_deck"] = True
    report["decks"].append(net)
    destination = tmp_path / "separate.sqlite3"
    assert capture.write_library(report, destination) == 2
    with sqlite3.connect(destination) as conn:
        decks = dm.list_decks(conn)
        assert len(decks) == 2
        for saved in decks:
            detail = dm.deck_detail(conn, saved["id"])
            deck = detail["deck"]
            assert [c["section"] for c in deck["cards"]] == [
                "Deck",
                "Sideboard",
                "Commander",
                "Companion",
            ]
            assert [(c["arena_id"], c["quantity"]) for c in deck["cards"]] == [
                (123, 98),
                (456, 1),
                (789, 1),
                (111, 1),
            ]
            assert deck["cards"][0]["name"] == "Card #123"
            raw = deck["metadata"]["raw_runtime_deck"]
            assert raw["skins"] == report["decks"][0]["skins"]
            assert raw["summary"]["NetDeckFolderId"] == {"raw_bytes": [0] * 20}
            assert dm.import_document(dm.export_document(detail)) == deck
        assert conn.execute("SELECT COUNT(*) FROM managed_deck_bindings").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM games").fetchone()[0] == 0


@pytest.mark.parametrize(
    "change", ["missing", "unknown", "duplicate", "quantity", "identity", "unloaded"]
)
def test_capture_refuses_incomplete_or_invalid_snapshot_before_creating_database(tmp_path, change):
    report = snapshot()
    deck = report["decks"][0]
    if change == "missing":
        deck["piles"].pop()
    elif change == "unknown":
        deck["piles"].append({"pile": 99, "entries": []})
    elif change == "duplicate":
        deck["piles"].append(deck["piles"][0])
    elif change == "quantity":
        deck["piles"][0]["entries"][0]["quantity"] = True
    elif change == "identity":
        deck["summary"]["DeckId"] = str(uuid.uuid4())
    else:
        deck["contents_loaded"] = False
    destination = tmp_path / "separate.sqlite3"
    with pytest.raises(ValueError):
        capture.write_library(report, destination)
    assert not destination.exists()
    assert not list(tmp_path.iterdir())


def test_capture_does_not_overwrite_existing_database(tmp_path):
    destination = tmp_path / "existing.sqlite3"
    destination.write_bytes(b"existing user data")
    with pytest.raises(ValueError, match="existing"):
        capture.write_library(snapshot(), destination)
    assert destination.read_bytes() == b"existing user data"


def test_capture_failure_does_not_publish_partial_database(tmp_path, monkeypatch):
    def fail(*args):
        raise OSError("disk full")

    monkeypatch.setattr(dm, "save_deck", fail)
    destination = tmp_path / "separate.sqlite3"
    with pytest.raises(OSError, match="disk full"):
        capture.write_library(snapshot(), destination)
    assert not list(tmp_path.iterdir())


def fake_runtime(monkeypatch, name="MTGA"):
    calls = []
    exports = SimpleNamespace(
        inspect=lambda: {"classes": [], "native_transfers_proven": False},
        refresh=lambda: calls.append("refresh")
        or {"force_refresh_successful": True, "native_transfers_proven": False},
        folder=lambda: calls.append("folder") or {"native_folder_proven": True},
        clearfolder=lambda: calls.append("cleanup") or {"removed": True},
        folderstatus=lambda: {"temporary_sections_remaining": 0},
    )
    script = SimpleNamespace(load=lambda: calls.append("load"), exports_sync=exports)
    session = SimpleNamespace(create_script=lambda _: script, detach=lambda: calls.append("detach"))

    def attach(pid):
        calls.append(("attach", pid))
        return session

    device = SimpleNamespace(
        enumerate_processes=lambda: [SimpleNamespace(pid=42, name=name)], attach=attach
    )
    monkeypatch.setitem(
        sys.modules, "frida", SimpleNamespace(get_local_device=lambda: device, __version__="test")
    )
    monkeypatch.setattr(
        runner, "Timer", lambda *args: SimpleNamespace(start=lambda: None, cancel=lambda: None)
    )
    return calls


def test_runner_default_is_inspection_and_always_detaches(tmp_path, monkeypatch):
    calls = fake_runtime(monkeypatch)
    output = tmp_path / "report.json"
    monkeypatch.setattr(sys, "argv", ["run.py", "--pid", "42", "--output", str(output)])
    assert runner.main() == 0
    assert calls == [("attach", 42), "load", "detach"]
    assert json.loads(output.read_text())["native_transfers_proven"] is False


def test_runner_refuses_other_processes(tmp_path, monkeypatch):
    calls = fake_runtime(monkeypatch, "other-game")
    output = tmp_path / "report.json"
    monkeypatch.setattr(sys, "argv", ["run.py", "--pid", "42", "--output", str(output)])
    assert runner.main() == 1
    assert calls == []
    assert not output.exists()


def test_read_only_refresh_report_is_saved_and_session_detaches(tmp_path, monkeypatch):
    calls = fake_runtime(monkeypatch)
    output = tmp_path / "refresh.json"
    monkeypatch.setattr(
        sys, "argv", ["run.py", "--pid", "42", "--mode", "refresh", "--output", str(output)]
    )
    assert runner.main() == 0
    assert calls == [("attach", 42), "load", "refresh", "detach"]
    assert json.loads(output.read_text())["force_refresh_successful"] is True


def test_temporary_folder_cleanup_runs_on_interruption(tmp_path, monkeypatch):
    calls = fake_runtime(monkeypatch)

    def interrupt(_):
        raise KeyboardInterrupt

    monkeypatch.setattr(runner.time, "sleep", interrupt)
    monkeypatch.setattr(
        sys,
        "argv",
        ["run.py", "--pid", "42", "--mode", "folder", "--output", str(tmp_path / "report.json")],
    )
    with pytest.raises(KeyboardInterrupt):
        runner.main()
    assert calls == [("attach", 42), "load", "folder", "cleanup", "detach"]


def copy_exports():
    report = snapshot()
    source = report["decks"][0]
    created = copy.deepcopy(source)
    created["name"] = created["summary"]["Name"] = "Tapps POC test"
    created["arena_id"] = created["summary"]["DeckId"] = str(uuid.uuid4())
    calls = []
    results = iter(
        [
            {"phase": "create_pending"},
            {"phase": "created_verified", "created_snapshot": created},
            {"phase": "complete", "native_transfers_proven": False},
        ]
    )
    exports = SimpleNamespace(
        cache=lambda: report,
        preparecopy=lambda *args: {
            "phase": "prepared",
            "source_snapshot": source,
            "test_snapshot": created,
        },
        createcopy=lambda: calls.append("create"),
        pollcopy=lambda: next(results),
        deletecopy=lambda archive: calls.append(("delete", archive)),
    )
    return exports, calls, created


def test_copy_dry_run_never_creates_or_deletes(tmp_path):
    exports, calls, _ = copy_exports()
    result = disposable.experiment(exports, tmp_path)
    assert result["native_writes_executed"] is False
    assert calls == []
    assert (tmp_path / "02-source.json").exists()


def test_copy_delete_uses_actual_created_snapshot_read_back_from_disk(tmp_path, monkeypatch):
    exports, calls, created = copy_exports()
    monkeypatch.setattr(disposable.time, "sleep", lambda _: None)

    def delete(archive):
        on_disk = json.loads((tmp_path / "05-created.json").read_text())["decks"][0]
        assert archive == on_disk == created
        calls.append(("delete", archive))

    exports.deletecopy = delete
    assert disposable.experiment(exports, tmp_path, execute=True)["phase"] == "complete"
    assert calls == ["create", ("delete", created)]


def test_created_copy_disk_failure_stops_before_delete(tmp_path, monkeypatch):
    exports, calls, _ = copy_exports()
    monkeypatch.setattr(disposable.time, "sleep", lambda _: None)
    real_persist = disposable.persist

    def persist(path, value):
        if path.name == "05-created.json":
            raise OSError("disk full")
        return real_persist(path, value)

    monkeypatch.setattr(disposable, "persist", persist)
    with pytest.raises(OSError, match="disk full"):
        disposable.experiment(exports, tmp_path, execute=True)
    assert calls == ["create"]


def test_unknown_create_stops_without_retry_or_delete(tmp_path):
    exports, calls, _ = copy_exports()

    def uncertain():
        raise TimeoutError("unknown server outcome")

    exports.pollcopy = uncertain
    with pytest.raises(TimeoutError):
        disposable.experiment(exports, tmp_path, execute=True)
    assert calls == ["create"]


def test_native_wait_deadline_does_not_retry_write(monkeypatch):
    times = iter([0, 0, 21])
    monkeypatch.setattr(disposable.time, "monotonic", lambda: next(times))
    monkeypatch.setattr(disposable.time, "sleep", lambda _: None)
    exports = SimpleNamespace(pollcopy=lambda: {"phase": "create_pending"})
    with pytest.raises(TimeoutError, match="uncertain"):
        disposable.await_phase(exports, "created_verified")
