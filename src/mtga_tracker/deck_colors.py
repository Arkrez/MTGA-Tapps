"""Deck Manager deck colors from Arena's local card DB, scored like the Overview's."""

from __future__ import annotations

import threading
import time

from .colors import BASIC_LAND_COLORS, score_deck_colors

# Rebuilt after this long so a set Arena downloads mid-session gains colors.
_TTL_SECONDS = 600
_LOCK = threading.Lock()
_INDEX = None
_BUILT = 0.0

# The commander's pips matter as much as the main deck's; a sideboard does not.
COLOR_SECTIONS = ("Deck", "Commander", "Companion")


def _index():
    global _INDEX, _BUILT
    with _LOCK:
        if _INDEX is None or time.monotonic() - _BUILT > _TTL_SECONDS:
            try:
                from .card_database import CardDatabase

                index = CardDatabase().deck_color_index()
            except Exception:
                index = ({}, {})
            # Cache only a populated index; an empty one may be a transient failure.
            if index[0] or _INDEX is None:
                _INDEX, _BUILT = index, time.monotonic()
        return _INDEX


def deck_colors(cards) -> str:
    """WUBRG letters ("C" when colorless, "" when unknown) for saved-deck cards.

    ``cards`` are dicts with section, quantity, name and an optional arena_id;
    text imports have no arena_id and are matched by name instead.
    """
    by_id, by_name = _index()
    rows = []
    for card in cards:
        if card.get("section") not in COLOR_SECTIONS:
            continue
        name = str(card.get("name") or "")
        basic = BASIC_LAND_COLORS.get(name)
        row = (
            ("Land", "", basic)
            if basic is not None
            else by_id.get(card.get("arena_id") or 0)
            or by_name.get(name)
            or by_name.get(name.split(" // ")[0].strip())
        )
        if row:
            rows.append((*row, card.get("quantity") or 1))
    return score_deck_colors(rows)
