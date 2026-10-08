"""Replay stream contract helpers (docs/REPLAY_FORMAT.md section 2)."""

import json

import pytest

from mtga_tracker.replay_stream import (
    EVENT_FIELDS,
    CardRegistry,
    EventLog,
    build_turns,
    card_key,
    encode_stream,
    primary_type_from_text,
    seat_layout,
    stream_header,
    validate_stream,
)


def test_card_key_prefers_arena_id_then_name_then_unknown():
    assert card_key(12345, "Llanowar Elves") == "a12345"
    assert card_key(None, "Llanowar Elves") == "n:Llanowar Elves"
    assert card_key(None, "Card #190883") == "unknown"
    assert card_key(None, None) == "unknown"


def test_card_registry_merges_metadata_and_splits_faces():
    cards = CardRegistry()
    key = cards.add("Unholy Annex // Ritual Chamber", 90001, primary_type="Enchantment")
    again = cards.add("Unholy Annex // Ritual Chamber", 90001, mana_cost="{2}{B}", is_token=False)
    assert key == again == "a90001"
    entry = cards.cards[key]
    assert entry["mana_cost"] == "{2}{B}"
    assert entry["primary_type"] == "Enchantment"
    assert [face["name"] for face in entry["faces"]] == ["Unholy Annex", "Ritual Chamber"]
    assert cards.add("Card #1") == "unknown"
    assert cards.cards["unknown"]["name"] == "Unknown card"
    names = cards.names_by_type()
    assert names["Ritual Chamber"] == "Enchantment"
    assert "Unknown card" not in names


def test_primary_type_from_text():
    assert primary_type_from_text("Creature, Artifact") == "Creature"
    assert primary_type_from_text("Legendary Enchantment — Saga") == "Enchantment"
    assert primary_type_from_text("Instant") == "Instant"
    assert primary_type_from_text(None) is None


def test_event_log_fills_every_field_and_keeps_time_monotonic():
    log = EventLog()
    log.at(10, 1, "Phase_Main1")
    first = log.emit("life", seat=1, life=19, delta=-1)
    log.at(5)  # an older timestamp must not move the clock back
    second = log.emit("note")
    assert first["source_obj"] is None and first["t"] == 10.0
    assert second["t"] == 10.0 and second["seq"] == 1 and second["turn"] == 1
    with pytest.raises(ValueError):
        log.emit("move", bogus=True)
    with pytest.raises(ValueError):
        log.emit("not_a_kind")


def test_stack_push_item_kind_travels_as_stack_kind():
    # The event's own "kind" is "stack_push"; the contract's spell/trigger
    # kind cannot share that key.
    assert "stack_kind" in EVENT_FIELDS["stack_push"]
    assert "kind" not in EVENT_FIELDS["stack_push"]


def test_build_turns_covers_each_turn_event_inclusively():
    log = EventLog()
    log.emit("game_start", seats_hand_sizes={}, library_sizes={})
    log.at(turn=1)
    log.emit("turn", turn=1, active_seat=2)
    log.emit("note")
    log.at(turn=2)
    log.emit("turn", turn=2, active_seat=1)
    turns = build_turns(
        log.events,
        [{"turn_number": 1, "started_at": "2026-01-01T00:00:00", "duration_seconds": 30}],
    )
    assert turns == [
        {
            "turn": 1,
            "seat": 2,
            "first_seq": 1,
            "last_seq": 2,
            "started_at": "2026-01-01T00:00:00",
            "duration_seconds": 30.0,
        },
        {
            "turn": 2,
            "seat": 1,
            "first_seq": 3,
            "last_seq": 3,
            "started_at": None,
            "duration_seconds": None,
        },
    ]


def test_seat_layout_never_assumes_player_is_seat_one():
    assert seat_layout([{"role": "player", "seat_id": 2}, {"role": "opponent", "seat_id": 1}]) == (
        2,
        1,
    )
    assert seat_layout([]) == (1, 2)
    assert seat_layout([{"role": "player", "seat_id": 2}]) == (2, 1)


def test_stream_header_reads_winner_format_and_seats():
    rows = {
        "games": [
            {
                "id": "g1",
                "started_at": "2026-06-04T00:01:00",
                "outcome": "loss",
                "winner_participant_id": "p-opp",
                "game_number": 2,
                "total_turns": 9,
                "duration_seconds": 300,
            }
        ],
        "matches": [{"format": "Traditional_Ladder", "best_of": 3}],
        "participants": [
            {
                "id": "p-me",
                "role": "player",
                "seat_id": 2,
                "display_name": "Me",
                "starting_life": 20,
            },
            {"id": "p-opp", "role": "opponent", "seat_id": 1, "display_name": "Them"},
        ],
        "participant_commanders": [{"participant_id": "p-opp", "card_name": "Commander X"}],
    }
    header = stream_header(rows, "reconstructed")
    assert header["player_seat"] == 2
    assert header["game"]["winner_seat"] == 1
    assert header["game"]["best_of"] == 3
    assert header["seats"]["2"]["name"] == "You"
    assert header["seats"]["1"]["name"] == "Them"
    assert header["seats"]["1"]["commanders"] == ["Commander X"]
    assert header["limitations"]


def _stream(events):
    turns = [
        {"turn": e["turn"], "seat": e["active_seat"], "first_seq": e["seq"], "last_seq": e["seq"]}
        for e in events
        if e["kind"] == "turn"
    ]
    return {"events": events, "turns": turns, "cards": {"a1": {"name": "X"}}}


def test_validate_stream_accepts_a_consistent_stream():
    log = EventLog()
    log.emit("game_start", seats_hand_sizes={"1": 1}, library_sizes={"1": 10})
    log.emit(
        "move",
        obj="r:1",
        card="a1",
        owner=1,
        controller=1,
        reason="draw",
        inferred=False,
        **{"from": "library", "to": "hand"},
    )
    log.emit("turn", turn=1, active_seat=1)
    log.emit(
        "move",
        obj="r:1",
        card="a1",
        owner=1,
        controller=1,
        reason="cast",
        inferred=False,
        **{"from": "hand", "to": "stack"},
    )
    log.emit(
        "stack_push",
        stack_id="s1",
        obj="r:1",
        card="a1",
        stack_kind="spell",
        controller=1,
        text="",
        targets=[],
    )
    log.emit("stack_resolve", stack_id="s1")
    log.emit(
        "move",
        obj="r:1",
        card="a1",
        owner=1,
        controller=1,
        reason="resolve",
        inferred=False,
        **{"from": "stack", "to": "battlefield"},
    )
    assert validate_stream(_stream(log.events)) == []


def test_validate_stream_reports_broken_guarantees():
    log = EventLog()
    log.emit("game_start", seats_hand_sizes={"1": 0}, library_sizes={"1": 0})
    log.emit("turn", turn=1, active_seat=1)
    log.emit(
        "move",
        obj="r:9",
        card=None,
        owner=1,
        controller=1,
        reason="destroy",
        inferred=False,
        **{"from": "battlefield", "to": "graveyard"},
    )
    log.emit(
        "move",
        obj="r:2",
        card=None,
        owner=1,
        controller=1,
        reason="draw",
        inferred=False,
        **{"from": "library", "to": "hand"},
    )
    log.emit("stack_resolve", stack_id="s404")
    problems = validate_stream(_stream(log.events))
    assert any("creates r:9 from battlefield" in p for p in problems)
    assert any("library of seat 1 negative" in p for p in problems)
    assert any("s404" in p for p in problems)


def test_encode_stream_is_compact_utf8_json():
    body = encode_stream({"cards": {"n:Æther Vial": {"name": "Æther Vial"}}})
    assert b" " not in body.replace(b"\xc3\x86ther Vial", b"")
    assert json.loads(body.decode("utf-8"))["cards"]["n:Æther Vial"]["name"] == "Æther Vial"
