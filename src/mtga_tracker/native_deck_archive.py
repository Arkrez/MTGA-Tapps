"""Portable, validated native deck archives; no attachment or Arena writes."""

from __future__ import annotations

import copy
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


def attribute(snapshot, key):
    return next(
        (a["value"] for a in snapshot["summary"].get("Attributes", []) if a.get("key") == key),
        None,
    )


# Arena's deck Format attribute values. Bo3 labels use the Traditional variant,
# matching how Arena labels Bo3-constructed decks.
_ARENA_FORMATS = {
    "standard": "Standard",
    "historic": "Historic",
    "explorer": "Explorer",
    "pioneer": "Explorer",
    "timeless": "Timeless",
    "alchemy": "Alchemy",
}
_TRADITIONAL = {"Standard", "Historic", "Explorer", "Alchemy"}


def arena_format(label):
    """Map a Deck Finder format label ("Standard / Bo3") to Arena's Format attribute.

    Arena stores a deck created without a Format as format "", so an
    unrecognized label falls back to Standard rather than leaving it empty.
    """
    lowered = " ".join((label or "").casefold().replace("_", " ").split())
    compact = lowered.replace(" ", "")
    if "brawl" in compact:
        return "HistoricBrawl" if "historic" in compact else "Brawl"
    base = next((v for k, v in _ARENA_FORMATS.items() if k in compact), "Standard")
    if base in _TRADITIONAL and ("traditional" in compact or "bo3" in compact):
        return "Traditional" + base
    return base


def tile_card(snapshot, card_type=None):
    """Pick a deck tile the way a player usually would: the most-played creature,
    else the most-played nonland card, else the first card."""
    entries = [c for p in snapshot.get("piles", []) if p["pile"] == 1 for c in p["entries"]]
    if not entries:
        return 0
    kinds = {c["id"]: (card_type(c["id"]) if card_type else None) for c in entries}
    for wanted in ("Creature", None):
        pool = [
            c
            for c in entries
            if (kinds[c["id"]] == wanted if wanted else kinds[c["id"]] not in (None, "Land"))
        ]
        if pool:
            return max(pool, key=lambda c: c["quantity"])["id"]
    return entries[0]["id"]


def with_import_summary(archive, format_name, tile_id):
    """Give an import draft the Format and tile a saved Arena deck carries.

    Arena's parser leaves both empty, and Arena then stores the deck with format
    "" and no tile art. The serialized summary and the snapshot are edited
    together, so preparation rebuilds exactly this summary (the same path a
    restore uses) and its snapshot check still holds.
    """
    archive = copy.deepcopy(validate_archive(archive))
    summary = json.loads(archive["summary_json"])
    snapshot = archive["source_snapshot"]["summary"]
    if (
        not isinstance(summary.get("Attributes"), dict)
        or not isinstance(snapshot.get("Attributes"), list)
        or type(summary.get("DeckTileId")) is not int
        or type(snapshot.get("DeckTileId")) is not int
    ):
        raise dm.DeckManagerError("Unsupported Arena deck summary. No deck was created.")
    # A Dictionary keeps insertion order, matching the appended snapshot pair.
    summary["Attributes"]["Format"] = format_name
    pair = next((a for a in snapshot["Attributes"] if a.get("key") == "Format"), None)
    if pair:
        pair["value"] = format_name
    else:
        snapshot["Attributes"].append({"key": "Format", "value": format_name})
    if tile_id:
        summary["DeckTileId"] = snapshot["DeckTileId"] = tile_id
    archive["summary_json"] = json.dumps(summary, ensure_ascii=False)
    return validate_archive(archive)


def import_draft(deck):
    """True for a text import's revision before Arena's server-loaded copy replaced it.

    Arena's parser builds a client-side draft: its summary lacks the bookkeeping
    attributes (Version, TileID, LastPlayed, IsFavorite) and cosmetic defaults
    that CreateDeck and every server-loaded deck carry, so it can never equal the
    created deck exactly.
    """
    metadata = deck.get("metadata", {})
    archive = metadata.get("native_archive")
    return (
        "native_import_request" in metadata
        and isinstance(archive, dict)
        and attribute(archive["source_snapshot"], "Version") is None
    )


def same_contents(actual, draft, *, restored_id):
    """Compare a created deck with its import draft: identity, name, format, piles, skins."""

    def contents(value):
        return {
            "arena_id": value["arena_id"],
            "deck_id": value["summary"].get("DeckId"),
            "name": value["name"],
            "summary_name": value["summary"].get("Name"),
            "format": attribute(value, "Format") or "",
            "net": value.get("is_net_deck"),
            "loaded": value.get("contents_loaded"),
            "piles": sorted(
                (p["pile"], sorted((c["id"], c["quantity"]) for c in p["entries"]))
                for p in value.get("piles", [])
            ),
            "skins": sorted(json.dumps(s, sort_keys=True) for s in value.get("skins", [])),
        }

    expected = contents(draft)
    expected["arena_id"] = expected["deck_id"] = restored_id
    return contents(actual) == expected


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
