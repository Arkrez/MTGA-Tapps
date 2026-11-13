"""Limited runs: sealed capture and crediting games to runs by deck."""

import json
import sqlite3
from datetime import datetime, timezone

import pytest

from mtga_tracker import deck_manager as dm, draft_api
from mtga_tracker.draft_capture import DraftCapture
from mtga_tracker.limited_runs import load_runs
from mtga_tracker.log_entry import LineBuffer

SEALED = "Sealed_TRK_20261110"


@pytest.fixture
def conn(tmp_path):
    connection = dm.library_connection(tmp_path / "tracker.sqlite3")
    connection.row_factory = None
    yield connection
    connection.close()


def _response(name, body, when):
    return f"[UnityCrossThreadLogger]{when}\n<== {name}({name}-id)\n{json.dumps(body)}"


def _request(name, request):
    return f"[UnityCrossThreadLogger]==> {name} {json.dumps({'id': 'x', 'request': json.dumps(request)})}"


def _feed(capture, lines):
    buffer = LineBuffer()
    for text in lines:
        for line in text.split("\n"):
            for entry in buffer.push_line(line):
                capture.consume(entry)
    for entry in buffer.flush():
        capture.consume(entry)


def _course(course_id, module, pool):
    return {
        "CourseId": course_id,
        "InternalEventName": SEALED,
        "CurrentModule": module,
        "CardPool": pool,
    }


def test_sealed_courses_become_runs_with_pool_deck_and_completion(conn):
    pool = list(range(1, 85))
    deck = {
        "MainDeck": [{"cardId": c, "quantity": 1} for c in range(1, 24)]
        + [{"cardId": 900, "quantity": 17}],
        "Sideboard": [{"cardId": c, "quantity": 1} for c in range(24, 85)],
    }
    _feed(
        DraftCapture(conn),
        [
            _response("EventJoin", _course("c1", "DeckSelect", pool), "11/11/2026 10:10:46 PM"),
            _request(
                "EventSetDeckV3",
                {"EventName": SEALED, "Summary": {"Name": "Sealed Deck"}, "Deck": deck},
            ),
            # A later login lists the course again: it must not open a second run.
            _response(
                "EventGetCoursesV2",
                {"Courses": [_course("c1", "CreateMatch", pool)]},
                "11/11/2026 10:40:00 PM",
            ),
            _response(
                "EventClaimPrize",
                {"Course": _course("c1", "Complete", [])},
                "11/11/2026 11:19:50 PM",
            ),
            # Joining again is a new run with a new course.
            _response(
                "EventJoin",
                _course("c2", "DeckSelect", list(range(100, 184))),
                "11/11/2026 11:22:07 PM",
            ),
        ],
    )
    rows = conn.execute(
        "SELECT id, kind, event_name, started_at, completed_at, card_pool_json, deck_json"
        " FROM drafts ORDER BY started_at"
    ).fetchall()
    assert [r[0] for r in rows] == ["sealed-c1", "sealed-c2"]
    first = rows[0]
    assert first[1:3] == ("sealed", SEALED)
    assert first[3] == "2026-11-11T22:10:46+00:00" and first[4] == "2026-11-11T23:19:50+00:00"
    assert json.loads(first[5]) == pool
    assert len(json.loads(first[6])["main"]) == 24
    assert rows[1][4] is None and rows[1][6] is None


def _game(conn, game_id, local_iso, event, outcome, main, sideboard=()):
    conn.execute("INSERT OR IGNORE INTO tracker_sessions (id, started_at) VALUES ('s', '')")
    conn.execute(
        "INSERT OR IGNORE INTO matches (id, session_id, started_at, event_name) VALUES (?, 's', '', ?)",
        (f"m-{event}", event),
    )
    conn.execute(
        "INSERT INTO games (id, session_id, match_id, game_number, started_at, outcome)"
        " VALUES (?, 's', ?, 1, ?, ?)",
        (game_id, f"m-{event}", local_iso, outcome),
    )
    conn.execute(
        "INSERT INTO participants (id, game_id, role) VALUES (?, ?, 'player')",
        (f"p-{game_id}", game_id),
    )
    for zone, cards in (("deck", main), ("sideboard", sideboard)):
        for card in cards:
            name = "Island" if card == 900 else f"Card {card}"
            conn.execute(
                "INSERT INTO game_deck_cards (game_id, participant_id, arena_id, display_name,"
                " deck_zone, quantity) VALUES (?, ?, ?, ?, ?, 1)",
                (game_id, f"p-{game_id}", card, name, zone),
            )


def _local(iso):
    moment = datetime.fromisoformat(iso).replace(tzinfo=timezone.utc).astimezone()
    return moment.replace(tzinfo=None).isoformat()


def test_games_join_the_run_whose_pool_holds_their_deck_and_the_rest_are_rebuilt(conn):
    conn.execute(
        "INSERT INTO drafts (id, kind, event_name, started_at, card_pool_json)"
        " VALUES ('sealed-c1', 'sealed', ?, '2026-11-11T22:00:00+00:00', ?)",
        (SEALED, json.dumps(list(range(1, 85)))),
    )
    deck_one = list(range(1, 24)) + [900]  # basics never count toward a match
    deck_two = list(range(200, 223)) + [900]
    _game(conn, "older-1", _local("2026-11-10T20:00:00"), SEALED, "win", deck_two, range(223, 270))
    _game(
        conn,
        "older-2",
        _local("2026-11-10T20:30:00"),
        SEALED,
        "loss",
        deck_two[:20] + [230, 231, 232],
    )
    _game(conn, "c1-game", _local("2026-11-11T22:30:00"), SEALED, "win", deck_one)
    # A new rebuilt run: its deck shares almost nothing with the one before.
    _game(conn, "later", _local("2026-11-13T20:00:00"), SEALED, "loss", list(range(300, 323)))
    # No decklist recorded: credited by time to the latest run that started before it.
    _game(conn, "bare", _local("2026-11-11T23:00:00"), SEALED, "loss", [])
    # Not a limited event: ignored.
    _game(conn, "ladder", _local("2026-11-11T23:30:00"), "Ladder", "win", deck_one)
    conn.commit()

    runs = {run.id: run for run in load_runs(conn)}
    assert [g.id for g in runs["sealed-c1"].games] == ["c1-game", "bare"]
    rebuilt = [run for run in runs.values() if run.rebuilt]
    assert [[g.id for g in run.games] for run in rebuilt] == [["older-1", "older-2"], ["later"]]
    first = rebuilt[0]
    assert first.kind == "sealed" and first.record == {"wins": 1, "losses": 1, "games": 2}
    # The pool of a rebuilt sealed run includes the sideboard (the rest of the pool).
    assert {223, 269} <= set(first.pool) and 900 not in first.pool
    assert first.deck["main"][0]["arena_id"] == 200

    # Pool matching alone (the time repair) never rebuilds or falls back to time.
    captured = {run.id: run for run in load_runs(conn, captured_only=True)}
    assert [g.id for g in captured["sealed-c1"].games] == ["c1-game"]
    assert not any(run.rebuilt for run in captured.values())


def test_api_lists_rebuilt_runs_and_tags_games_with_their_run(conn, tmp_path, monkeypatch):
    _game(
        conn,
        "g1",
        _local("2026-10-30T03:06:00"),
        "ArenaDirect_FRA_Play_Sealed_20261023",
        "loss",
        [5, 6, 7],
    )
    _game(
        conn,
        "g2",
        _local("2026-10-30T03:20:00"),
        "ArenaDirect_FRA_Play_Sealed_20261023",
        "loss",
        [5, 6, 7, 8],
    )
    conn.commit()

    class Cards:
        def draft_card_facts(self, ids):
            return {
                i: {"name": f"Card {i}", "rarity": "rare" if i == 8 else "common", "colors": "U"}
                for i in ids
            }

    monkeypatch.setattr(draft_api, "_cards", Cards())
    db = tmp_path / "tracker.sqlite3"
    [row] = draft_api.list_drafts(db)["drafts"]
    assert row["id"] == "games-g1" and row["rebuilt"] and row["kind"] == "sealed"
    assert row["record"] == {"wins": 0, "losses": 2, "games": 2}
    assert row["top_card"] == {"arena_id": 8, "name": "Card 8"}
    stream = draft_api.draft_stream(db, "games-g1")
    assert stream["draft"]["rebuilt"] and stream["picks"] == []
    assert stream["draft"]["record"]["losses"] == 2
    assert [c["arena_id"] for c in stream["deck"]["main"]] == [5, 6, 7, 8]

    read = sqlite3.connect(db)
    tags = draft_api.game_run_tags(read)
    read.close()
    assert tags["g1"]["id"] == tags["g2"]["id"] == "games-g1"
    assert tags["g1"]["art"]["name"] == "Card 8"
