"""Dashboard-only native deck testing with an isolated library and read-only game guard.

Run with this worktree's src on PYTHONPATH. Never launches a tracker or Arena.
"""

import argparse
from contextlib import closing
from pathlib import Path
import sqlite3
from urllib.parse import urlparse

from mtga_tracker import dashboard, deck_manager as dm, deck_native_api as api


def create_preview_server(db: Path, tracker_db: Path, port: int):
    db = db.expanduser().resolve()
    tracker_db = tracker_db.expanduser().resolve()
    if db == tracker_db or (db.exists() and db.samefile(tracker_db)):
        raise ValueError("Use a separate preview database, not the active tracker database.")
    if not tracker_db.is_file():
        raise ValueError("The active tracker database must exist for the read-only game guard.")

    def active_game(_preview_db):
        # A separate deck library has no live_status updates. Read the running
        # tracker's row instead, never copy a stale snapshot or write into it.
        try:
            with closing(
                sqlite3.connect(tracker_db.as_uri() + "?mode=ro", uri=True, timeout=2)
            ) as conn:
                conn.execute("PRAGMA query_only=ON")
                row = conn.execute("SELECT in_game FROM live_status WHERE id=1").fetchone()
                return row is None or bool(row[0])
        except sqlite3.Error:
            return True

    api.game_in_progress = active_game
    connection = dm.library_connection(db)
    connection.close()
    server = dashboard.create_dashboard_server("127.0.0.1", port, db_path=db)
    base_handler = server.RequestHandlerClass

    class PreviewHandler(base_handler):
        def do_POST(self):
            if urlparse(self.path).path.startswith("/api/deck-manager/"):
                return super().do_POST()
            # Other pages can be browsed, but cannot change global app settings,
            # launch companions, restore analytics or control the running app.
            self.close_connection = True
            dashboard._send_bytes(
                self,
                403,
                b'{"error":"This preview only manages its separate deck library."}',
                "application/json",
            )

    server.RequestHandlerClass = PreviewHandler
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True, help="Separate persistent test library.")
    parser.add_argument(
        "--tracker-db", type=Path, required=True, help="Active tracker DB, read-only."
    )
    parser.add_argument("--port", type=int, default=8880)
    args = parser.parse_args()
    server = create_preview_server(args.db, args.tracker_db, args.port)
    print(f"Live Deck Manager: http://127.0.0.1:{args.port}/#/deck-manager", flush=True)
    print("Separate deck library; no second tracker. Arena transfers are live.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
