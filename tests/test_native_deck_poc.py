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
disk_restore = load("disk_restore")


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


def typed_archive():
    report = snapshot()
    return dict(
        report,
        archive_kind="arena_typed_model_poc",
        source_snapshot=report["decks"][0],
        model_json=json.dumps({"printing_id": 9007199254740993}),
        summary_json=json.dumps(report["decks"][0]["summary"]),
    )


def restore_exports():
    archive = typed_archive()
    restored = copy.deepcopy(archive["source_snapshot"])
    restored["name"] = restored["summary"]["Name"] = "Tapps Restore test"
    restored["arena_id"] = restored["summary"]["DeckId"] = str(uuid.uuid4())
    calls = []
    results = iter(
        [
            {"phase": "created_verified", "created_snapshot": restored},
            {"phase": "complete"},
        ]
    )

    def prepare(from_disk, operation_id):
        calls.append(("prepare_from_disk", from_disk))
        return {
            "operation_id": operation_id,
            "reconstructed_from_disk": True,
            "source_snapshot": archive["source_snapshot"],
            "test_snapshot": restored,
        }

    exports = SimpleNamespace(
        preparerestore=prepare,
        createcopy=lambda: calls.append("create"),
        pollcopy=lambda: next(results),
        verifyrestoredcopy=lambda: {
            "fetched_snapshot": restored,
            "restored_from_disk_verified": True,
            "full_deck_promise_successful": True,
        },
        writeready=lambda: True,
        deletecopy=lambda data: calls.append(("delete", data)),
    )
    return archive, exports, calls, restored


def test_disk_reconstruction_uses_reloaded_file_and_keeps_large_integer_json_text(tmp_path):
    archive, exports, calls, _ = restore_exports()
    path = tmp_path / "archive.json"
    disposable.persist(path, archive)
    archive["model_json"] = "{}"  # Altering the old in-memory value cannot affect restore.
    result = disk_restore.restore_experiment(exports, path, tmp_path)
    assert result["native_writes_executed"] is False
    assert json.loads(calls[0][1]["model_json"])["printing_id"] == 9007199254740993
    assert len(calls) == 1


@pytest.mark.parametrize("payload", [{"$type": "Arbitrary"}, {"nested": [{"$type": "Arbitrary"}]}])
def test_archive_cannot_request_arbitrary_deserialization_type(payload):
    archive = typed_archive()
    archive["model_json"] = json.dumps(payload)
    with pytest.raises(ValueError, match="arbitrary"):
        disk_restore.validate_archive(archive)


def test_disk_restore_archives_fetched_result_before_deleting_only_that_copy(tmp_path):
    archive, exports, calls, restored = restore_exports()
    path = tmp_path / "archive.json"
    disposable.persist(path, archive)

    def delete(value):
        assert value == json.loads((tmp_path / "07-fetched.json").read_text())["decks"][0]
        assert value["arena_id"] != archive["source_snapshot"]["arena_id"]
        calls.append(("delete", value))

    exports.deletecopy = delete
    result = disk_restore.restore_experiment(exports, path, tmp_path, execute=True)
    assert result["native_disk_restore_proven"] is True
    assert calls[1:] == ["create", ("delete", restored)]


def test_disk_restore_fetch_or_disk_failure_prevents_delete(tmp_path, monkeypatch):
    archive, exports, calls, _ = restore_exports()
    path = tmp_path / "archive.json"
    disposable.persist(path, archive)
    real_persist = disk_restore.persist

    def fail(path, value):
        if path.name == "07-fetched.json":
            raise OSError("disk full")
        return real_persist(path, value)

    monkeypatch.setattr(disk_restore, "persist", fail)
    with pytest.raises(OSError, match="disk full"):
        disk_restore.restore_experiment(exports, path, tmp_path, execute=True)
    assert calls[1:] == ["create"]


def test_restore_fidelity_failure_is_recorded_and_own_copy_cleaned_up(tmp_path):
    archive, exports, calls, restored = restore_exports()
    path = tmp_path / "archive.json"
    disposable.persist(path, archive)
    exports.verifyrestoredcopy = lambda: {
        "fetched_snapshot": restored,
        "restored_from_disk_verified": False,
        "full_deck_promise_successful": True,
    }
    result = disk_restore.restore_experiment(exports, path, tmp_path, execute=True)
    assert result["native_disk_restore_proven"] is False
    assert calls[-1] == ("delete", restored)


def recovery_journal(tmp_path):
    archive, exports, calls, restored = restore_exports()
    original = tmp_path / "original"
    output = tmp_path / "recovery"
    original.mkdir()
    output.mkdir()
    path = original / "02-disk-archive.json"
    disposable.persist(path, archive)
    _, digest = disk_restore.load_archive(path)
    disposable.persist(original / "03-loaded-archive.json", {"sha256": digest})
    disposable.persist(original / "01-before.json", snapshot_from(archive["source_snapshot"]))
    operation_id = str(uuid.uuid4())
    prepared = {"operation_id": operation_id, "test_snapshot": restored}
    disposable.persist(original / "04-reconstructed.json", prepared)
    disposable.persist(original / "05-create-intent.json", {"operation_id": operation_id})
    disposable.persist(original / "06-created.json", snapshot_from(restored))
    exports.adoptrestoredcopy = lambda *args: calls.append("adopt") or {"no_create_retry": True}
    exports.pollcopy = lambda: {"phase": "complete"}
    return original, output, exports, calls, restored


def snapshot_from(deck):
    return dict(snapshot(), decks=[deck])


def test_recovery_removes_only_existing_copy_without_create_retry(tmp_path):
    original, output, exports, calls, restored = recovery_journal(tmp_path)
    result = disk_restore.resume_experiment(exports, original, output, execute=True)
    assert result["native_disk_restore_proven"] is True
    assert calls == ["adopt", ("delete", restored)]
    assert json.loads((output / "07-fetched.json").read_text())["decks"] == [restored]


def test_recovery_default_only_verifies_and_archives(tmp_path):
    original, output, exports, calls, _ = recovery_journal(tmp_path)
    result = disk_restore.resume_experiment(exports, original, output)
    assert result["native_writes_executed"] is False
    assert calls == ["adopt"]
    assert not (output / "09-delete-test-copy-intent.json").exists()


@pytest.mark.parametrize("change", ["archive", "original_identity", "operation"])
def test_recovery_rejects_changed_journal_before_native_adoption(tmp_path, change):
    original, output, exports, calls, _ = recovery_journal(tmp_path)
    if change == "archive":
        path = original / "02-disk-archive.json"
        path.write_text(path.read_text() + "\n")
    elif change == "original_identity":
        source = json.loads((original / "01-before.json").read_text())["decks"][0]
        (original / "06-created.json").write_text(json.dumps(snapshot_from(source)))
    else:
        (original / "05-create-intent.json").write_text(json.dumps({"operation_id": "different"}))
    with pytest.raises(ValueError):
        disk_restore.resume_experiment(exports, original, output, execute=True)
    assert calls == []
    assert not (output / "09-delete-test-copy-intent.json").exists()
