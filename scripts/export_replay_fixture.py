#!/usr/bin/env python3
"""Export one game's replay rows as an anonymized test fixture.

    venv/bin/python scripts/export_replay_fixture.py <game_id> <name> [--db PATH]

Writes ``tests/fixtures/replay/<name>.json`` with every row the replay
needs (games, matches, participants, participant_commanders, game_events,
game_opening_hand_cards, game_mulligan_hands, game_drawn_cards,
game_deck_cards, game_turns, game_library_events and the relevant cards),
in the shape ``replay_builder.load_replay_rows`` returns, so tests feed it
straight into ``build_stream``.

The database is opened read-only (``mode=ro`` URI plus ``query_only``): it
is safe while the tracker is live and never writes to it. Player and
opponent display names are replaced with "You" and "Opponent" everywhere,
event text included; Arena deck and match GUIDs are dropped.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any, Dict

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from mtga_tracker.replay_builder import load_replay_rows  # noqa: E402

DEFAULT_DB = ROOT / "data" / "mtga_tracker.sqlite3"
DEFAULT_OUT = ROOT / "tests" / "fixtures" / "replay"
#: Columns that identify an account or an Arena object rather than the game.
DROPPED_COLUMNS = {
    "participants": ("deck_id",),
    "matches": ("raw_match_id",),
}


def anonymize(rows: Dict[str, Any]) -> Dict[str, Any]:
    """Replace both display names everywhere and drop identifying columns."""
    replacements = {}
    for participant in rows.get("participants") or []:
        name = str(participant.get("display_name") or "").strip()
        if name:
            replacements[name] = "You" if participant.get("role") == "player" else "Opponent"
    patterns = [
        (re.compile(rf"(?<!\w){re.escape(name)}(?!\w)", re.IGNORECASE), label)
        # Longest first so one name containing another is replaced whole.
        for name, label in sorted(replacements.items(), key=lambda item: -len(item[0]))
    ]

    def scrub(value: Any) -> Any:
        if isinstance(value, str):
            for pattern, label in patterns:
                value = pattern.sub(label, value)
            return value
        if isinstance(value, list):
            return [scrub(item) for item in value]
        if isinstance(value, dict):
            return {key: scrub(item) for key, item in value.items()}
        return value

    cleaned = scrub(rows)
    for table, columns in DROPPED_COLUMNS.items():
        for row in cleaned.get(table) or []:
            for column in columns:
                if column in row:
                    row[column] = None
    return cleaned


def export(db_path: Path, game_id: str) -> Dict[str, Any]:
    db_uri = db_path.expanduser().resolve().as_uri() + "?mode=ro"
    conn = sqlite3.connect(db_uri, uri=True)
    try:
        conn.execute("PRAGMA query_only = ON")
        rows = load_replay_rows(conn, game_id)
    finally:
        conn.close()
    if rows is None:
        raise LookupError(f"No recorded game for id: {game_id}")
    return anonymize(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("game_id")
    parser.add_argument("name", help="fixture file stem, e.g. short_game")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    try:
        rows = export(args.db, args.game_id)
    except (LookupError, sqlite3.Error) as exc:
        print(f"export failed: {exc}", file=sys.stderr)
        return 1
    args.out_dir.mkdir(parents=True, exist_ok=True)
    out = args.out_dir / f"{args.name}.json"
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(rows, handle, indent=1, sort_keys=True, ensure_ascii=False)
        handle.write("\n")
    print(f"wrote {out} ({len(rows.get('game_events') or [])} events)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
