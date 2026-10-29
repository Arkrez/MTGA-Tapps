"""Draft Replay capture, storage and API (docs/DRAFT_REPLAY.md)."""

import json
from datetime import datetime, timezone

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


def _set_deck(event, main, sideboard=(), name="Draft Deck"):
    deck = {
        "MainDeck": [{"cardId": c, "quantity": q} for c, q in main],
        "Sideboard": [{"cardId": c, "quantity": q} for c, q in sideboard],
        "CommandZone": [],
        "Companions": [],
    }
    return _request("EventSetDeckV3", {"EventName": event, "Summary": {"Name": name}, "Deck": deck})


def test_submitted_deck_attaches_to_its_draft_and_the_latest_one_wins(conn, tmp_path, monkeypatch):
    log = PLAYER_LOG + [
        _set_deck(PLAYER_EVENT, [(10, 1), (12, 1), (81, 15)], [(20, 1)]),
        "[UnityCrossThreadLogger]10/19/2026 9:30:00 AM\n<== Unrelated(x)\n{}",
        _set_deck(PLAYER_EVENT, [(10, 1), (20, 1), (81, 15)], [(12, 1)], name="Second Try"),
        _set_deck("Ladder", [(99, 60)]),
    ]
    _feed(DraftCapture(conn), log)
    deck = json.loads(conn.execute("SELECT deck_json FROM drafts WHERE id = 'd-1'").fetchone()[0])
    assert deck["name"] == "Second Try"
    assert deck["main"] == [[10, 1], [20, 1], [81, 15]] and deck["sideboard"] == [[12, 1]]

    # A rescan replays the older submission after the newer one is stored: it must not win.
    path = tmp_path / "Player.log"
    path.write_text("\n".join(log[:-3]) + "\n")
    capture_logs(conn, [path])
    assert (
        json.loads(conn.execute("SELECT deck_json FROM drafts").fetchone()[0])["name"]
        == "Second Try"
    )

    conn.commit()
    monkeypatch.setattr(
        draft_api,
        "_cards",
        type("Cards", (), {"draft_card_facts": lambda self, ids: {}})(),
    )
    _, stream = draft_api.handle_get("/api/draft", {"id": ["d-1"]}, tmp_path / "tracker.sqlite3")
    assert stream["deck"]["main"][2] == {"arena_id": 81, "quantity": 15}
    assert "81" in stream["cards"]


def test_stream_serves_drafts_recorded_before_the_deck_column(tmp_path, monkeypatch):
    import sqlite3

    db = tmp_path / "old.sqlite3"
    old = sqlite3.connect(db)
    old.execute(
        "CREATE TABLE drafts (id TEXT PRIMARY KEY, kind TEXT, event_name TEXT,"
        " course_id TEXT, started_at TEXT, updated_at TEXT, completed_at TEXT,"
        " card_pool_json TEXT)"
    )
    old.execute(
        "CREATE TABLE draft_picks (draft_id TEXT, pack_number INTEGER,"
        " pick_number INTEGER, pack_cards_json TEXT, picked_json TEXT, observed_at TEXT)"
    )
    old.execute("INSERT INTO drafts (id, kind) VALUES ('old', 'player')")
    old.commit()
    old.close()
    monkeypatch.setattr(
        draft_api, "_cards", type("Cards", (), {"draft_card_facts": lambda self, ids: {}})()
    )
    status, stream = draft_api.handle_get("/api/draft", {"id": ["old"]}, db)
    assert status == 200 and stream["deck"] is None


def test_draft_records_count_the_event_games_until_the_next_draft(conn, tmp_path, monkeypatch):
    """Two runs of one event: each owns the games from its start to the next one's."""
    for draft_id, started in (
        ("first", "2026-10-19T05:00:00+00:00"),
        ("second", "2026-10-19T09:00:00+00:00"),
    ):
        conn.execute(
            "INSERT INTO drafts (id, kind, event_name, started_at) VALUES (?, 'player', ?, ?)",
            (draft_id, PLAYER_EVENT, started),
        )
    conn.execute(
        "INSERT INTO tracker_sessions (id, started_at) VALUES ('s', '2026-10-19T00:00:00')"
    )
    conn.execute(
        "INSERT INTO matches (id, session_id, started_at, event_name) VALUES ('m', 's', '', ?)",
        (PLAYER_EVENT,),
    )
    conn.execute(
        "INSERT INTO matches (id, session_id, started_at, event_name) VALUES ('l', 's', '', 'Ladder')"
    )

    def local(iso):  # games store naive local time
        moment = datetime.fromisoformat(iso).replace(tzinfo=timezone.utc).astimezone()
        return moment.replace(tzinfo=None).isoformat()

    games = [
        ("g0", "m", local("2026-10-19T04:00:00"), "win"),  # before either draft: nobody's
        ("g1", "m", local("2026-10-19T06:00:00"), "win"),
        ("g2", "m", local("2026-10-19T07:00:00"), "loss"),
        ("g3", "m", local("2026-10-19T10:00:00"), "loss"),
        ("g4", "l", local("2026-10-19T10:30:00"), "win"),  # another event
    ]
    for game_id, match_id, started, outcome in games:
        conn.execute(
            "INSERT INTO games (id, session_id, match_id, game_number, started_at, outcome)"
            " VALUES (?, 's', ?, 1, ?, ?)",
            (game_id, match_id, started, outcome),
        )
    conn.commit()
    monkeypatch.setattr(
        draft_api, "_cards", type("Cards", (), {"draft_card_facts": lambda self, ids: {}})()
    )
    rows = {
        r["id"]: r["record"] for r in draft_api.list_drafts(tmp_path / "tracker.sqlite3")["drafts"]
    }
    assert rows == {
        "first": {"wins": 1, "losses": 1, "games": 2},
        "second": {"wins": 0, "losses": 1, "games": 1},
    }


def test_draft_analytics_counts_cards_only_in_games_you_held_them(conn, tmp_path, monkeypatch):
    """Two drafts of one event with Alpha and Beta in both decks. A card's win
    rate counts only games where it was in hand (opening hand, drawn, played)."""
    for draft_id, started, picked in (
        ("d1", "2026-10-19T01:00:00+00:00", [10, 11, 12]),
        ("d2", "2026-10-19T05:00:00+00:00", [10, 11]),
    ):
        deck = {
            "name": "Draft Deck",
            "main": [[10, 1], [11, 1], [99, 17]],
            "sideboard": [],
            "submitted_at": started,
        }
        conn.execute(
            "INSERT INTO drafts (id, kind, event_name, started_at, deck_json)"
            " VALUES (?, 'player', ?, ?, ?)",
            (draft_id, PLAYER_EVENT, started, json.dumps(deck)),
        )
        for n, card in enumerate(picked, 1):
            conn.execute(
                "INSERT INTO draft_picks (draft_id, pack_number, pick_number, picked_json)"
                " VALUES (?, 1, ?, ?)",
                (draft_id, n, json.dumps([card])),
            )
    conn.execute("INSERT INTO tracker_sessions (id, started_at) VALUES ('s', '')")
    conn.execute(
        "INSERT INTO matches (id, session_id, started_at, event_name) VALUES ('m', 's', '', ?)",
        (PLAYER_EVENT,),
    )
    for card_id, name in ((1, "Alpha"), (2, "Beta"), (3, "Gamma"), (4, "Forest")):
        conn.execute(
            "INSERT INTO cards (id, name, first_seen_at) VALUES (?, ?, '')", (card_id, name)
        )

    def local(iso):
        moment = datetime.fromisoformat(iso).replace(tzinfo=timezone.utc).astimezone()
        return moment.replace(tzinfo=None).isoformat()

    # (hour, outcome, cards in opening hand, cards drawn later, cards only played)
    games = [
        ("02", "win", [1], [2], []),  # d1: Alpha + Beta held
        ("03", "win", [1], [], []),  # d1: Alpha only
        ("04", "loss", [], [4], []),  # d1: neither (Beta stayed in the library)
        ("06", "win", [], [], [2]),  # d2: Beta seen only as played
        ("07", "loss", [1], [2], []),  # d2: both held
    ]
    for n, (hour, outcome, opening, drawn, played) in enumerate(games):
        game_id, participant = f"g{n}", f"p{n}"
        conn.execute(
            "INSERT INTO games (id, session_id, match_id, game_number, started_at, outcome)"
            " VALUES (?, 's', 'm', 1, ?, ?)",
            (game_id, local(f"2026-10-19T{hour}:00:00"), outcome),
        )
        conn.execute(
            "INSERT INTO participants (id, game_id, role) VALUES (?, ?, 'player')",
            (participant, game_id),
        )
        for pos, card_id in enumerate(opening):
            conn.execute(
                "INSERT INTO game_opening_hand_cards"
                " (game_id, participant_id, card_id, display_name, hand_position)"
                " VALUES (?, ?, ?, 'x', ?)",
                (game_id, participant, card_id, pos),
            )
        for pos, card_id in enumerate(drawn):
            conn.execute(
                "INSERT INTO game_drawn_cards"
                " (game_id, participant_id, card_id, display_name, draw_position)"
                " VALUES (?, ?, ?, 'x', ?)",
                (game_id, participant, card_id, pos),
            )
        for card_id in played:
            conn.execute(
                "INSERT INTO game_card_summary"
                " (game_id, participant_id, card_id, display_name, played_count, drawn_count)"
                " VALUES (?, ?, ?, 'x', 1, 0)",
                (game_id, participant, card_id),
            )
    conn.commit()

    class Cards:
        def draft_card_facts(self, ids):
            names = {10: "Alpha", 11: "Beta", 12: "Gamma", 99: "Forest"}
            return {
                i: {"name": names[i], "rarity": "basic" if i == 99 else "common", "colors": "G"}
                for i in ids
            }

    monkeypatch.setattr(draft_api, "_cards", Cards())
    status, data = draft_api.handle_get("/api/drafts/analytics", {}, tmp_path / "tracker.sqlite3")
    assert status == 200
    # Deck records still count every game.
    assert data["summary"] == {"drafts": 2, "wins": 3, "losses": 2, "games": 5, "win_rate": 0.6}
    cards = {c["name"]: c for c in data["cards"]}
    assert "Forest" not in cards  # basics are left out
    assert cards["Alpha"]["in_hand"] == {
        "drafts": 2,
        "wins": 2,
        "losses": 1,
        "games": 3,
        "win_rate": 2 / 3,
    }
    assert cards["Beta"]["in_hand"] == {
        "drafts": 2,
        "wins": 2,
        "losses": 1,
        "games": 3,
        "win_rate": 2 / 3,
    }
    assert (cards["Alpha"]["picked"], cards["Alpha"]["in_deck"]) == (2, 2)
    # Gamma was picked but never played: no games, no rate.
    assert cards["Gamma"]["in_hand"]["games"] == 0 and cards["Gamma"]["in_hand"]["win_rate"] is None
    assert cards["Alpha"]["first_picks"] == 2 and cards["Alpha"]["avg_pick"] == 1.0

    monkeypatch.setattr(draft_api, "PAIR_MIN_GAMES", 2)
    data = draft_api.draft_analytics(tmp_path / "tracker.sqlite3")
    [pair] = data["pairs"]["best"]
    assert [c["name"] for c in pair["cards"]] == ["Alpha", "Beta"]
    # Held together in g0 (win) and g4 (loss) only.
    assert (pair["wins"], pair["losses"], pair["drafts"]) == (1, 1, 2)


def test_clock_offset_rounds_to_quarter_hours_and_ignores_implausible_files(tmp_path):
    import os
    from datetime import timedelta

    from mtga_tracker.draft_capture import clock_offset, file_clock_offset

    log = datetime(2026, 10, 28, 3, 12, 19)
    assert clock_offset(log, datetime(2026, 10, 28, 3, 13, 2, tzinfo=timezone.utc)) == timedelta(0)
    assert clock_offset(log, datetime(2026, 10, 28, 10, 12, 50, tzinfo=timezone.utc)) == timedelta(
        hours=7
    )

    path = tmp_path / "Player-prev.log"
    path.write_text("[UnityCrossThreadLogger]10/28/2026 3:12:19 AM\n<== X(1)\n{}\n")
    written = datetime(2026, 10, 28, 3, 12, 30, tzinfo=timezone.utc).timestamp()
    os.utime(path, (written, written))
    assert file_clock_offset(path) == timedelta(0)  # current clients log UTC
    stale = datetime(2026, 11, 2, tzinfo=timezone.utc).timestamp()
    os.utime(path, (stale, stale))
    assert file_clock_offset(path) is None  # copied or touched later: no evidence


def test_live_capture_measures_the_log_clock(conn):
    """A client logging local time at UTC-7: the live reader works out the offset."""
    from datetime import timedelta

    from mtga_tracker.log_entry import LogEntry

    now = datetime.now(timezone.utc)
    log_time = (now - timedelta(hours=7)).replace(tzinfo=None)
    capture = DraftCapture(conn, live=True)
    body = _notify("live-1", 1, 1, [1, 2, 3])
    capture.consume(
        LogEntry(header="[UnityCrossThreadLogger]", body="x", first_line="x", timestamp=log_time)
    )
    capture.consume(LogEntry(header="[UnityCrossThreadLogger]", body=body, first_line=body))
    started = datetime.fromisoformat(
        conn.execute("SELECT started_at FROM drafts WHERE id = 'live-1'").fetchone()[0]
    )
    assert abs(started - now) < timedelta(minutes=2)


def _deck_game(conn, game_id, started_local, outcome, cards):
    conn.execute("INSERT OR IGNORE INTO tracker_sessions (id, started_at) VALUES ('s', '')")
    conn.execute(
        "INSERT OR IGNORE INTO matches (id, session_id, started_at, event_name)"
        " VALUES ('m', 's', '', ?)",
        (PLAYER_EVENT,),
    )
    conn.execute(
        "INSERT INTO games (id, session_id, match_id, game_number, started_at, outcome)"
        " VALUES (?, 's', 'm', 1, ?, ?)",
        (game_id, started_local, outcome),
    )
    conn.execute(
        "INSERT INTO participants (id, game_id, role) VALUES (?, ?, 'player')",
        (f"p-{game_id}", game_id),
    )
    for card in cards:
        conn.execute(
            "INSERT INTO game_deck_cards"
            " (game_id, participant_id, arena_id, display_name, deck_zone, quantity)"
            " VALUES (?, ?, ?, 'Card', 'deck', 1)",
            (game_id, f"p-{game_id}", card),
        )


def test_games_go_to_the_draft_whose_deck_they_played_whatever_the_clocks_say(
    conn, tmp_path, monkeypatch
):
    import time

    from mtga_tracker.draft_capture import repair_shifted_draft_times

    monkeypatch.setenv("TZ", "America/Los_Angeles")
    time.tzset()
    try:
        for draft_id, started, main in (
            # Stamped 7 h late (UTC log read as local): its games look earlier than it.
            ("late", "2026-10-24T06:10:11+00:00", [1, 2, 3, 4, 5]),
            # Right already (from a local-time log); must be left alone.
            ("right", "2026-10-25T01:00:00+00:00", [6, 7, 8, 9, 10]),
        ):
            deck = {
                "name": "Draft Deck",
                "main": [[c, 1] for c in main],
                "sideboard": [],
                "submitted_at": started,
            }
            conn.execute(
                "INSERT INTO drafts (id, kind, event_name, started_at, completed_at, deck_json)"
                " VALUES (?, 'player', ?, ?, ?, ?)",
                (draft_id, PLAYER_EVENT, started, started, json.dumps(deck)),
            )
        # Local (PDT) game times: 17:13 on the 23rd is 00:13 UTC on the 24th.
        _deck_game(conn, "a", "2026-10-23T17:13:00", "win", [1, 2, 3, 4, 5, 90])
        _deck_game(conn, "b", "2026-10-23T17:40:00", "loss", [1, 2, 3, 4])
        _deck_game(conn, "c", "2026-10-24T19:00:00", "win", [6, 7, 8, 9, 10])
        conn.commit()
        monkeypatch.setattr(
            draft_api, "_cards", type("Cards", (), {"draft_card_facts": lambda self, ids: {}})()
        )
        db = tmp_path / "tracker.sqlite3"
        records = {r["id"]: r["record"] for r in draft_api.list_drafts(db)["drafts"]}
        assert records["late"] == {"wins": 1, "losses": 1, "games": 2}
        assert records["right"] == {"wins": 1, "losses": 0, "games": 1}

        repair_shifted_draft_times(conn)
        times = dict(conn.execute("SELECT id, started_at FROM drafts").fetchall())
        assert times["late"] == "2026-10-23T23:10:11+00:00"
        assert times["right"] == "2026-10-25T01:00:00+00:00"
    finally:
        monkeypatch.delenv("TZ")
        time.tzset()
