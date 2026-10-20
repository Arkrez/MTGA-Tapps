"""Draft Replay capture, storage and API (docs/DRAFT_REPLAY.md)."""

import json

import pytest

from mtga_tracker import deck_manager as dm, draft_api
from mtga_tracker.backup import merge_snapshot_into
from mtga_tracker.dashboard import RESET_TABLES
from mtga_tracker.draft_capture import DraftCapture, capture_logs
from mtga_tracker.log_entry import LineBuffer

BOT_EVENT = "QuickDraft_FRA_20261001"
PLAYER_EVENT = "PremierDraft_FRA_20260929"


def _request(name, request):
    payload = {"id": f"{name}-id", "request": json.dumps(request)}
    return f"[UnityCrossThreadLogger]==> {name} {json.dumps(payload)}"


def _response(name, body, when="10/19/2026 8:37:16 AM"):
    return f"[UnityCrossThreadLogger]{when}\n<== {name}({name}-id)\n{json.dumps(body)}"


def _course(event, course_id, module):
    return {
        "CourseId": course_id,
        "InternalEventName": event,
        "CurrentModule": module,
        "CardPool": [],
    }


def _bot_status(name, pack, pick, cards, picked, status="PickNext", when="10/19/2026 8:37:16 AM"):
    payload = {
        "Result": "Success",
        "EventName": BOT_EVENT,
        "DraftStatus": status,
        "PackNumber": pack,
        "PickNumber": pick,
        "DraftPack": [str(c) for c in cards],
        "PickedCards": [str(c) for c in picked],
    }
    return _response(name, {"CurrentModule": "BotDraft", "Payload": json.dumps(payload)}, when)


def _bot_pick(pack, pick, card):
    info = {"EventName": BOT_EVENT, "CardIds": [str(card)], "PackNumber": pack, "PickNumber": pick}
    return _request("BotDraftDraftPick", {"EventName": BOT_EVENT, "PickInfo": info})


def _notify(draft_id, pack, pick, cards):
    body = {
        "draftId": draft_id,
        "SelfPick": pick,
        "SelfPack": pack,
        "PackCards": ",".join(map(str, cards)),
    }
    return f"[UnityCrossThreadLogger]Draft.Notify {json.dumps(body)}\nUnityEngine.DebugLogHandler:Internal_Log()"


def _make_pick(draft_id, pack, pick, cards):
    return _request(
        "EventPlayerDraftMakePick",
        {"DraftId": draft_id, "GrpIds": cards, "Pack": pack, "Pick": pick},
    )


def _complete(event, course_id, pool, draft_id=None):
    body = {
        "CourseId": course_id,
        "InternalEventName": event,
        "CurrentModule": "DeckSelect",
        "CardPool": pool,
    }
    if draft_id:
        body["DraftId"] = draft_id
    return _response("DraftCompleteDraft", body, "10/19/2026 9:00:00 AM")


BOT_LOG = [
    _response("EventJoin", {"Course": _course(BOT_EVENT, "c-bot", "BotDraft")}),
    _bot_status("BotDraftDraftStatus", 0, 0, [1, 2, 3, 4], []),
    _bot_pick(0, 0, 2),
    _bot_status("BotDraftDraftPick", 0, 1, [5, 6, 7], [2]),
    _bot_pick(0, 1, 7),
    _bot_status("BotDraftDraftPick", 0, 2, [1, 3], [2, 7]),
    _bot_pick(0, 2, 1),
    _bot_status("BotDraftDraftPick", 0, 3, [], [2, 7, 1], status="Completed"),
    _complete(BOT_EVENT, "c-bot", [2, 7, 1]),
]

PLAYER_LOG = [
    _response("EventJoin", {"Course": _course(PLAYER_EVENT, "c-player", "PlayerDraft")}),
    _notify("d-1", 1, 1, [10, 11, 12, 13]),
    _notify("d-1", 1, 1, [10, 11, 12, 13]),  # Arena repeats each push
    _make_pick("d-1", 1, 1, [10, 12]),  # Pick Two: two cards at once
    _notify("d-1", 1, 2, [20, 21]),
    _make_pick("d-1", 1, 2, [21, 20]),
    _complete(PLAYER_EVENT, "c-player", [10, 12, 21, 20], draft_id="d-1"),
]


@pytest.fixture
def conn(tmp_path):
    connection = dm.library_connection(tmp_path / "tracker.sqlite3")
    yield connection
    connection.close()


def _feed(capture, lines):
    buffer = LineBuffer()
    for text in lines:
        for line in text.split("\n"):
            for entry in buffer.push_line(line):
                capture.consume(entry)
    for entry in buffer.flush():
        capture.consume(entry)


def _picks(conn, draft_id):
    return [
        (pack, pick, json.loads(cards or "[]"), json.loads(picked or "[]"))
        for pack, pick, cards, picked in conn.execute(
            "SELECT pack_number, pick_number, pack_cards_json, picked_json FROM draft_picks"
            " WHERE draft_id = ? ORDER BY pack_number, pick_number",
            (draft_id,),
        )
    ]


def test_migration_creates_draft_tables_and_reset_clears_them(conn):
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"drafts", "draft_picks"} <= tables
    assert "drafts" in RESET_TABLES and "draft_picks" in RESET_TABLES
    assert RESET_TABLES.index("draft_picks") < RESET_TABLES.index("drafts")


def test_bot_draft_records_each_pack_pick_and_the_final_pool(conn):
    _feed(DraftCapture(conn), BOT_LOG)
    draft = conn.execute(
        "SELECT id, kind, event_name, course_id, completed_at, card_pool_json FROM drafts"
    ).fetchall()
    assert len(draft) == 1
    draft_id, kind, event, course, completed, pool = draft[0]
    assert (draft_id, kind, event, course) == ("bot-c-bot", "bot", BOT_EVENT, "c-bot")
    assert completed and json.loads(pool) == [2, 7, 1]
    assert _picks(conn, draft_id) == [
        (1, 1, [1, 2, 3, 4], [2]),
        (1, 2, [5, 6, 7], [7]),
        (1, 3, [1, 3], [1]),
    ]


def test_player_draft_dedupes_repeated_pushes_and_keeps_pick_two_picks(conn):
    _feed(DraftCapture(conn), PLAYER_LOG)
    row = conn.execute(
        "SELECT kind, event_name, course_id, completed_at FROM drafts WHERE id = 'd-1'"
    ).fetchone()
    assert row[:3] == ("player", PLAYER_EVENT, "c-player") and row[3]
    assert _picks(conn, "d-1") == [(1, 1, [10, 11, 12, 13], [10, 12]), (1, 2, [20, 21], [21, 20])]


def test_rescanning_logs_is_idempotent_and_matches_the_live_capture(conn, tmp_path):
    _feed(DraftCapture(conn), BOT_LOG + PLAYER_LOG)
    before = {d: _picks(conn, d) for (d,) in conn.execute("SELECT id FROM drafts")}
    prev, current = tmp_path / "Player-prev.log", tmp_path / "Player.log"
    prev.write_text("\n".join(BOT_LOG) + "\n")
    current.write_text("\n".join(PLAYER_LOG) + "\n")
    for _ in range(2):
        result = capture_logs(conn, [prev, current, tmp_path / "missing.log"])
        assert result == {"drafts": 2, "logs": ["Player-prev.log", "Player.log"]}
    after = {d: _picks(conn, d) for (d,) in conn.execute("SELECT id FROM drafts")}
    assert after == before


def test_bot_draft_seen_mid_way_without_its_course_continues_one_draft(conn):
    capture = DraftCapture(conn)
    _feed(capture, [_bot_status("BotDraftDraftStatus", 1, 4, [8, 9], [2, 7, 1, 3, 5])])
    _feed(
        capture,
        [_bot_pick(1, 4, 9), _bot_status("BotDraftDraftPick", 1, 5, [6], [2, 7, 1, 3, 5, 9])],
    )
    (draft_id,) = conn.execute("SELECT id FROM drafts").fetchone()
    assert not draft_id.startswith("bot-c")
    assert _picks(conn, draft_id) == [(2, 5, [8, 9], [9]), (2, 6, [6], [])]


def test_a_second_bot_draft_of_the_same_event_starts_a_new_row(conn):
    capture = DraftCapture(conn)
    _feed(capture, BOT_LOG[1:4])  # no course: first draft
    _feed(
        capture,
        [_bot_status("BotDraftDraftStatus", 0, 0, [9, 8], [], when="10/20/2026 1:00:00 PM")],
    )
    assert conn.execute("SELECT COUNT(*) FROM drafts").fetchone()[0] == 2


def test_api_lists_drafts_and_serves_a_stream_with_card_facts(conn, tmp_path, monkeypatch):
    _feed(DraftCapture(conn), BOT_LOG + PLAYER_LOG)
    conn.commit()

    class Cards:
        def draft_card_facts(self, ids):
            return {
                i: {
                    "name": f"Card {i}",
                    "rarity": "rare" if i == 2 else "common",
                    "colors": "W" if i < 10 else "G",
                }
                for i in ids
                if i != 13
            }

    monkeypatch.setattr(draft_api, "_cards", Cards())
    db = tmp_path / "tracker.sqlite3"
    status, listing = draft_api.handle_get("/api/drafts", {}, db)
    assert status == 200
    rows = {row["id"]: row for row in listing["drafts"]}
    assert rows["bot-c-bot"]["first_pick"] == {"arena_id": 2, "name": "Card 2"}
    assert rows["bot-c-bot"]["picks"] == 3 and rows["bot-c-bot"]["colors"] == "W"
    assert rows["d-1"]["format_label"].startswith("Premier Draft")

    status, stream = draft_api.handle_get("/api/draft", {"id": ["d-1"]}, db)
    assert status == 200 and stream["version"] == 1
    assert stream["picks"][0]["picked"] == [10, 12]
    assert stream["cards"]["13"] == {"rarity": "common", "name": "Card #13", "arena_id": 13}
    assert stream["pool"] == [10, 12, 21, 20]

    assert draft_api.handle_get("/api/draft", {}, db)[0] == 400
    assert draft_api.handle_get("/api/draft", {"id": ["nope"]}, db)[0] == 404
    assert draft_api.handle_get("/api/drafts", {}, tmp_path / "absent.sqlite3") == (
        200,
        {"drafts": []},
    )


def test_backup_merge_unions_drafts_by_id(tmp_path):
    local_path, source_path = tmp_path / "local.db", tmp_path / "source.db"
    with dm.library_connection(source_path) as remote:
        _feed(DraftCapture(remote), PLAYER_LOG)
    with dm.library_connection(local_path) as local:
        _feed(DraftCapture(local), BOT_LOG)
        result = merge_snapshot_into(local, source_path)
        assert result["drafts"] == 1 and result["draft_picks"] == 2
        assert local.execute("SELECT COUNT(*) FROM drafts").fetchone()[0] == 2
        assert merge_snapshot_into(local, source_path)["drafts"] == 0
