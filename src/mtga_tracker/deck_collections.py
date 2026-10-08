"""Local collection membership; removing a collection always retains its decks."""

import uuid

from . import deck_manager as dm


def list_collections(conn):
    return [
        dict(zip(("id", "name", "created_at", "updated_at"), row))
        for row in conn.execute(
            "SELECT id,name,created_at,updated_at FROM managed_deck_collections "
            "ORDER BY name COLLATE NOCASE,id"
        )
    ]


def validate_destination(conn, collection_id):
    if collection_id is not None and (
        not isinstance(collection_id, str)
        or not conn.execute(
            "SELECT 1 FROM managed_deck_collections WHERE id=?", (collection_id,)
        ).fetchone()
    ):
        raise dm.DeckManagerError("Choose an existing collection or Unsorted.")


def save_collection(conn, name, collection_id=None):
    if not isinstance(name, str) or not name.strip() or len(name) > 80:
        raise dm.DeckManagerError("Collection names must contain 1–80 characters.")
    name = name.strip()
    if name.casefold() == "unsorted":
        raise dm.DeckManagerError("Unsorted is reserved for decks without a collection.")
    stamp = dm.now()
    with conn:
        # Serialize uniqueness checks against other dashboard requests.
        conn.execute("UPDATE managed_deck_collections SET id=id")
        if collection_id:
            validate_destination(conn, collection_id)
        if conn.execute(
            "SELECT 1 FROM managed_deck_collections WHERE name=? COLLATE NOCASE AND id!=?",
            (name, collection_id or ""),
        ).fetchone():
            raise dm.DeckManagerError("A collection with that name already exists.")
        if collection_id:
            conn.execute(
                "UPDATE managed_deck_collections SET name=?,updated_at=? WHERE id=?",
                (name, stamp, collection_id),
            )
        else:
            collection_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO managed_deck_collections VALUES (?,?,?,?)",
                (collection_id, name, stamp, stamp),
            )
    return {"id": collection_id, "name": name}


def move_decks(conn, deck_ids, collection_id):
    if (
        not isinstance(deck_ids, list)
        or not 1 <= len(deck_ids) <= 2000
        or any(not isinstance(i, str) or not i for i in deck_ids)
        or len(set(deck_ids)) != len(deck_ids)
    ):
        raise dm.DeckManagerError("Select distinct saved decks to move.")
    with conn:
        conn.execute("UPDATE managed_decks SET id=id WHERE id=?", (deck_ids[0],))
        validate_destination(conn, collection_id)
        for deck_id in deck_ids:
            row = conn.execute(
                "SELECT trashed_at FROM managed_decks WHERE id=?", (deck_id,)
            ).fetchone()
            if row is None or row[0]:
                raise dm.DeckManagerError(
                    "A selected deck is missing or in Trash. Refresh the list."
                )
        conn.executemany(
            "UPDATE managed_decks SET collection_id=?,updated_at=? WHERE id=?",
            [(collection_id, dm.now(), deck_id) for deck_id in deck_ids],
        )
    return len(deck_ids)


def remove_collection(conn, collection_id):
    with conn:
        conn.execute("UPDATE managed_deck_collections SET id=id WHERE id=?", (collection_id,))
        validate_destination(conn, collection_id)
        if collection_id is None:
            raise dm.DeckManagerError("Unsorted cannot be removed.")
        changed = conn.execute(
            "UPDATE managed_decks SET collection_id=NULL,updated_at=? " "WHERE collection_id=?",
            (dm.now(), collection_id),
        ).rowcount
        conn.execute("DELETE FROM managed_deck_collections WHERE id=?", (collection_id,))
    return changed


def merge_collections(conn):
    """Map incoming collection IDs, combining collections with the same name."""
    if not conn.execute(
        "SELECT 1 FROM src.sqlite_master WHERE name='managed_deck_collections'"
    ).fetchone():
        return {}
    mapping = {}
    for row in conn.execute("SELECT * FROM src.managed_deck_collections").fetchall():
        same_name = conn.execute(
            "SELECT id FROM main.managed_deck_collections " "WHERE name=? COLLATE NOCASE",
            (row["name"],),
        ).fetchone()
        by_id = conn.execute(
            "SELECT * FROM main.managed_deck_collections WHERE id=?", (row["id"],)
        ).fetchone()
        if same_name and same_name[0] != row["id"]:
            mapping[row["id"]] = same_name[0]
        elif by_id:
            mapping[row["id"]] = row["id"]
            if row["updated_at"] >= by_id["updated_at"]:
                conn.execute(
                    "UPDATE main.managed_deck_collections SET name=?,updated_at=? WHERE id=?",
                    (row["name"], row["updated_at"], row["id"]),
                )
        else:
            conn.execute("INSERT INTO main.managed_deck_collections VALUES (?,?,?,?)", tuple(row))
            mapping[row["id"]] = row["id"]
    return mapping
