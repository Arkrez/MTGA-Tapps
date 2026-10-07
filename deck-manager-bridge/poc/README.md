# Native Deck Manager experiment

An explicit, attach-only proof of concept for the running macOS Unity 6 IL2CPP
Arena client. It is not loaded by the tracker, shipped in its bundle, or exposed
through dashboard endpoints. See [live results](../../docs/plans/deck-manager/NATIVE_POC.md).

The probe resolves exported IL2CPP APIs and checked managed signatures at runtime.
Game service/UI operations run on Unity's main thread through a one-shot listener
on `UnitySynchronizationContext.Exec`. It does not launch or restart Arena, install
a game mod, patch its files, or copy authentication tokens. Reports contain
personal deck data: keep them outside git. New report files use mode `0600`.

## Setup and read checks

From this branch's repository root, create an isolated environment:

```sh
python3 -m venv /tmp/tapps-native-poc
/tmp/tapps-native-poc/bin/python -m pip install -r deck-manager-bridge/poc/requirements.txt
```

Obtain the running Arena PID using the OS process monitor. Substitute that PID
for `ARENA_PID` below; every command requires it explicitly and refuses a
different process name. Output paths must be new.

```sh
/tmp/tapps-native-poc/bin/python deck-manager-bridge/poc/run.py \
  --pid ARENA_PID --mode inspect --output /tmp/arena-metadata.json
/tmp/tapps-native-poc/bin/python deck-manager-bridge/poc/run.py \
  --pid ARENA_PID --mode cache --output /tmp/arena-cache.json
/tmp/tapps-native-poc/bin/python deck-manager-bridge/poc/run.py \
  --pid ARENA_PID --mode service --output /tmp/arena-service.json
PYTHONPATH=src venv/bin/python deck-manager-bridge/poc/capture.py \
  /tmp/arena-cache.json /tmp/arena-experiment.sqlite3
```

`inspect` is the default; it enumerates relevant classes and methods only.
`cache` captures loaded decks, all four card piles, printing IDs, quantities,
summary attributes and skins. It queries Arena's actual limit decision; it
does not count all cached summaries as user slots. `service` calls `GetFullDeck`
for one ordinary cached deck and checks its promise and returned identity.

`capture.py` validates every ordinary deck before creating a **separate new**
SQLite library. It preserves raw runtime metadata, verifies persisted hashes,
and publishes the finished file exclusively. It never modifies a live tracker
database or Arena. Unknown/missing piles and unsupported fields stop the probe;
card names can remain unresolved while numeric printing IDs stay intact.
The snapshot is a cache observation, not an authenticated current account roster.

## Temporary native section

Only run this explicit UI mutation when the user has agreed to the test and
Arena is on Decks outside a match:

```sh
/tmp/tapps-native-poc/bin/python deck-manager-bridge/poc/run.py \
  --pid ARENA_PID --mode folder --show-seconds 30 --output /tmp/arena-folder.json
```

This clones Arena's folder prefab, labels it **Tapps Collection (proof of concept)**,
and places it immediately after Starter Decks. It is empty. The probe holds the
objects with Unity 6 pointer-sized GC handles, removes the section after 5–60
seconds, and verifies no test section remains on the following Unity frame.
Cleanup is also attempted on interruption. A lost attachment can prevent cleanup;
leaving Decks destroys these scene objects. The POC recognizes the English
Starter Decks label only. No save/delete deck service is used by this mode.

## Prepared disposable-copy service test

Dry run (no native deck writes):

```sh
PYTHONPATH=src /tmp/tapps-native-poc/bin/python deck-manager-bridge/poc/disposable_copy.py \
  --pid ARENA_PID --output /tmp/arena-copy-dry-run
```

It picks a complete non-net cached deck (or the explicit `--source UUID`),
converts it through Arena's own model helpers into an independent in-memory
draft, gives the draft a new UUID/name, checks piles and skins, and archives
the source and draft privately. The original remains unchanged. The helper
normalized `IsFavorite` in the observed draft; this does not claim complete
metadata fidelity for a future restore constructor.

**The following write mode has not been run against Arena.** Run it only after
the user approves this specific create/delete test:

```sh
PYTHONPATH=src /tmp/tapps-native-poc/bin/python deck-manager-bridge/poc/disposable_copy.py \
  --pid ARENA_PID --output /tmp/arena-copy-write-test --execute
```

The reviewed sequence is:

1. Verify Decks is open and Arena reports capacity; fsync the source and intent.
2. Call `CreateDeck(draft, "Imported", false)` once; await successful completion.
3. Obtain the actual resulting ID; require it not to belong to any original deck.
4. Verify the named test copy's piles/skins; fsync and read back its full snapshot.
5. Allow `DeleteDeck` only for that internally recorded, unchanged test copy.
6. Await deletion, force a roster refresh, verify its absence, original cached
   identities still present, and the original source snapshot unchanged.

No arbitrary deck deletion RPC exists. Disk failure, scene change, request
failure or timeout stops the sequence. An uncertain creation is never retried;
any created copy is retained for review. Releasing handles/detaching **never**
deletes a deck. The private experiment directory is a record, not a production
transfer recovery journal. A copy test proves service access; it does **not**
prove restoration by reconstructing a client deck from a disk archive.

## Checks and references

```sh
PYTHONPATH=src venv/bin/python -m pytest tests/test_native_deck_poc.py -q
node --check deck-manager-bridge/poc/probe.js
```

Offline tests cover exact archival, incomplete captures, no overwrite/partial
publication, wrong PID refusal, interruption cleanup, and durable boundaries
before deleting a test copy. They never attach to the game.

References: [Frida API](https://frida.re/docs/javascript-api/),
[Unity dispatcher source](https://github.com/Unity-Technologies/UnityCsReference/blob/master/Runtime/Export/Scripting/UnitySynchronizationContext.cs),
[Enhancement Suite service/UI precedent](https://github.com/Beligal/MTGA-Enhancement-Suite/tree/2a0647cf40adde49686d1c0c8957c147114ccb9c/Plugin),
and [IL2CPP bridge](https://github.com/vfsfitvnm/frida-il2cpp-bridge).
This experiment uses independently written code; it does not vendor those implementations.
