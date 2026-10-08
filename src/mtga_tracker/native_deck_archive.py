"""Portable, validated native deck archives; no attachment or Arena writes."""

from __future__ import annotations

import json
import uuid

from . import deck_manager as dm

PILES = {
    "Main": "Deck",
    "Sideboard": "Sideboard",
    "CommandZone": "Commander",
    "Companions": "Companion",
}


def snapshot_document(snapshot, pile_names, resolve_name=None):
    if not isinstance(snapshot, dict) or snapshot.get("is_net_deck") is not False:
        raise dm.DeckManagerError("Only your own Arena decks can be transferred.")
    arena_id = str(uuid.UUID(snapshot["arena_id"]))
    summary = snapshot["summary"]
    if summary.get("DeckId") != arena_id or summary.get("Name") != snapshot.get("name"):
        raise dm.DeckManagerError("Arena deck identity changed.")
    if snapshot.get("contents_loaded") is not True or not isinstance(snapshot.get("skins"), list):
        raise dm.DeckManagerError("Arena has not loaded the complete deck.")
    cards, seen = [], set()
    for pile in snapshot.get("piles", []):
        name = pile_names.get(str(pile["pile"]))
        if name not in PILES or name in seen:
            raise dm.DeckManagerError("Unsupported or repeated Arena deck pile.")
        seen.add(name)
        for card in pile["entries"]:
            if type(card["id"]) is not int or card["id"] <= 0:
                raise dm.DeckManagerError("Invalid Arena printing ID.")
            cards.append(
                {
                    "section": PILES[name],
                    "quantity": card["quantity"],
                    "arena_id": card["id"],
                    "name": (resolve_name(card["id"]) if resolve_name else None)
                    or f"Card #{card['id']}",
                    "set_code": None,
                    "collector_number": None,
                }
            )
    if seen != set(PILES):
        raise dm.DeckManagerError("Arena deck is missing a required pile.")
    attributes = {a["key"]: a["value"] for a in summary.get("Attributes", [])}
    return dm.validate_deck(
        {
            "name": snapshot["name"],
            "format_name": attributes.get("Format") or "",
            "cards": cards,
            "import_text": None,
            "source": "arena_native",
            "completeness": "full",
            "metadata": {"arena_deck_id": arena_id},
        }
    )


def validate_archive(archive):
    if (
        not isinstance(archive, dict)
        or archive.get("schema") != 1
        or archive.get("archive_kind") != "arena_typed_model_poc"
    ):
        raise dm.DeckManagerError(
            "This revision has no native Arena backup. Back it up from Arena first."
        )
    snapshot_document(archive["source_snapshot"], archive["pile_names"])
    for key in ("model_json", "summary_json"):
        value = archive.get(key)
        if not isinstance(value, str) or len(value) > 20_000:
            raise dm.DeckManagerError("Invalid native deck archive.")
        decoded = json.loads(value)
        if not isinstance(decoded, dict):
            raise dm.DeckManagerError("Invalid native deck model.")

        def check(item):
            if isinstance(item, dict):
                if "$type" in item:
                    raise dm.DeckManagerError("Native archives cannot select executable types.")
                for child in item.values():
                    check(child)
            elif isinstance(item, list):
                for child in item:
                    check(child)

        check(decoded)
    return archive


def document(archive, resolve_name=None):
    validate_archive(archive)
    result = snapshot_document(archive["source_snapshot"], archive["pile_names"], resolve_name)
    result["metadata"]["native_archive"] = archive
    return dm.validate_deck(result)


def equivalent(left, right, *, restored_id=None):
    """Compare complete snapshots; only observed empty-description equivalence."""
    left, right = json.loads(json.dumps(left)), json.loads(json.dumps(right))
    if restored_id:
        right["arena_id"] = right["summary"]["DeckId"] = restored_id
    for value in (left, right):
        if value["summary"].get("Description") is None:
            value["summary"]["Description"] = ""
    return left == right


def revision_archive(deck):
    archive = validate_archive(deck.get("metadata", {}).get("native_archive"))
    expected = snapshot_document(archive["source_snapshot"], archive["pile_names"])

    def piles(value):
        if any(c.get("arena_id") is None for c in value["cards"]):
            raise dm.DeckManagerError("This revision has lost its native printing IDs.")
        return sorted((c["section"], c["arena_id"], c["quantity"]) for c in value["cards"])

    if (
        deck["name"] != expected["name"]
        or deck.get("format_name", "") != expected["format_name"]
        or piles(deck) != piles(expected)
    ):
        raise dm.DeckManagerError(
            "This revision differs from its native backup. "
            "Choose an earlier native revision or back it up from Arena again."
        )
    return archive
