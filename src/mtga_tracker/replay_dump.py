"""Print one game's replay stream as JSON (read-only).

    python -m mtga_tracker.replay_dump <game_id> [--db PATH] [--summary]

Uses the same code path as ``GET /api/replay``: the builder for games with
``replay_version`` set, the text reconstructor otherwise. The database is
opened read-only, so it is safe to run while the tracker is live.
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path
from typing import List, Optional

from .paths import DATA_DIR
from .replay_builder import replay_for_game
from .replay_stream import ReplayUnavailable, validate_stream


def _summary(stream: dict) -> str:
    kinds = collections.Counter(event["kind"] for event in stream["events"])
    problems = validate_stream(stream)
    lines = [
        f"game {stream['game']['id']} ({stream['game']['format']}, {stream['game']['outcome']})",
        f"fidelity {stream['fidelity']}, {len(stream['events'])} events, "
        f"{len(stream['turns'])} turns, {len(stream['cards'])} cards",
        "kinds: " + ", ".join(f"{kind}={count}" for kind, count in kinds.most_common()),
        f"invariant problems: {len(problems)}",
    ]
    lines.extend(f"  {problem}" for problem in problems[:20])
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("game_id", help="games.id of the game to replay")
    parser.add_argument(
        "--db",
        type=Path,
        default=DATA_DIR / "mtga_tracker.sqlite3",
        help="analytics database (opened read-only)",
    )
    parser.add_argument("--compact", action="store_true", help="one-line JSON")
    parser.add_argument(
        "--summary", action="store_true", help="event counts and invariant check instead of JSON"
    )
    args = parser.parse_args(argv)
    try:
        stream = replay_for_game(args.db, args.game_id)
    except ReplayUnavailable as exc:
        print(f"replay unavailable: {exc.reason}", file=sys.stderr)
        return 2
    except (FileNotFoundError, LookupError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    if args.summary:
        print(_summary(stream))
    elif args.compact:
        print(json.dumps(stream, separators=(",", ":"), ensure_ascii=False))
    else:
        print(json.dumps(stream, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
