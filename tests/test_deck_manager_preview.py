"""The test dashboard never writes into the running tracker's database."""

from pathlib import Path
import runpy
import sqlite3
from types import SimpleNamespace

import pytest

from mtga_tracker import dashboard, deck_native_api as api


create_preview = runpy.run_path(
    str(Path(__file__).resolve().parents[1] / "scripts" / "preview_deck_manager.py")
)["create_preview_server"]


def test_preview_uses_isolated_library_and_fresh_read_only_game_guard(tmp_path, monkeypatch):
    tracker = tmp_path / "tracker.db"
    preview = tmp_path / "preview.db"
    with sqlite3.connect(tracker) as conn:
        conn.execute("CREATE TABLE live_status (id INTEGER PRIMARY KEY, in_game INTEGER)")
        conn.execute("INSERT INTO live_status VALUES (1, 0)")
    monkeypatch.setattr(api, "game_in_progress", api.game_in_progress)
    monkeypatch.setattr(
        dashboard,
        "create_dashboard_server",
        lambda *args, **kwargs: SimpleNamespace(RequestHandlerClass=dashboard.DashboardHandler),
    )
    create_preview(preview, tracker, 0)
    assert not api.game_in_progress(preview)
    with sqlite3.connect(tracker) as conn:
        conn.execute("UPDATE live_status SET in_game=1")
    assert api.game_in_progress(preview)
    with sqlite3.connect(tracker) as conn:
        assert conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall() == [
            ("live_status",)
        ]
    tracker.unlink()
    assert api.game_in_progress(preview)
    assert not tracker.exists()


def test_preview_rejects_the_tracker_database_and_its_alias(tmp_path):
    tracker = tmp_path / "tracker.db"
    tracker.touch()
    alias = tmp_path / "alias.db"
    alias.symlink_to(tracker)
    for preview in (tracker, alias):
        with pytest.raises(ValueError, match="separate"):
            create_preview(preview, tracker, 0)
