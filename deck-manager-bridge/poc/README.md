# Native Deck Manager experiment

An explicit, attach-only proof of concept for the running macOS Unity 6 IL2CPP
Arena client. It is not loaded by the tracker, shipped in its bundle, or exposed
through dashboard endpoints. See [live results](../../docs/plans/deck-manager/NATIVE_POC.md).

The probe resolves exported IL2CPP APIs and checked managed signatures at runtime.
Game service/UI operations run on Unity's main thread through a one-shot listener
on `UnitySynchronizationContext.Exec`. It does not launch or restart Arena, install
a game mod, patch its files, or copy authentication tokens. Reports contain
personal deck data: keep them outside git. New report files use mode `0600`.
Metadata discovery borrows an existing attached IL2CPP thread without detaching
it; only a helper attachment created by this probe is released.

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
/tmp/tapps-native-poc/bin/python deck-manager-bridge/poc/run.py \
  --pid ARENA_PID --mode refresh --output /tmp/arena-refreshed-cache.json
PYTHONPATH=src venv/bin/python deck-manager-bridge/poc/capture.py \
  /tmp/arena-cache.json /tmp/arena-experiment.sqlite3
```

`inspect` is the default; it enumerates relevant classes and methods only.
`cache` captures loaded decks, all four card piles, printing IDs, quantities,
summary attributes and skins. It queries Arena's actual limit decision; it
does not count all cached summaries as user slots. `service` calls `GetFullDeck`
for one ordinary cached deck and checks its promise and returned identity.
`refresh` awaits a successful `ForceRefreshCachedDecks` promise and captures the
resulting cache. It makes no save/delete calls and tolerates the native Decks
selector temporarily rebuilding while retaining the service identity check.

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

**The live Mac create/delete test completed after read-only reconciliation.**
The initial runner stopped during a temporary Decks-screen rebuild after
deletion was requested; no writes were repeated. A successful separate refresh
proved the test copy absent and original decks intact. The subsequent polling
fix also completed the later disk-restored copy's cleanup.
Run write mode only after the user approves that specific create/delete test:

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
   identities still present, and the original source snapshot unchanged (null
   and empty descriptions are equivalent).

No arbitrary deck deletion RPC exists. Disk failure, scene change, request
failure or timeout stops the sequence. An uncertain creation is never retried;
any created copy is retained for review. Releasing handles/detaching **never**
deletes a deck. The private experiment directory is a record, not a production
transfer recovery journal. A copy test proves service access; it does **not**
prove restoration by reconstructing a client deck from a disk archive.

## Disk reconstruction and recovery

**One disk-reconstructed deck persisted across an Arena restart and was verified
and removed.** The initial verification probe crashed Arena after creation;
an unsafe borrowed-thread detach path was fixed before successful recovery.
This is a development feasibility result, not production reliability.

Dry run (capture, detach, load the file in a fresh attachment, construct and compare
without saving any Arena deck):

```sh
PYTHONPATH=src /tmp/tapps-native-poc/bin/python deck-manager-bridge/poc/disk_restore.py \
  --pid ARENA_PID --output /tmp/arena-disk-dry-run
```

With approval for the specific duplicate create/delete test, add `--execute` and
use a new output directory. The original source is never deleted. The typed
archive retains model JSON as text, including Int64 style values; reconstruction
restores checked physical summary fields, excluding computed setters that can
rewrite attributes. It compares the full rebuilt snapshot before assigning a new
test identity/name, checks capacity and creates once. A successful roster refresh
and `GetFullDeck` verify the actual saved copy before durable archival and cleanup.
Deserialization uses explicit checked native types and rejects `$type` properties.

If interrupted **after** `06-created.json` exists, inspect the private journal
before any further write. Do not rerun the normal create experiment. Recovery
uses a new directory and the existing actual copy's recorded identity:

```sh
PYTHONPATH=src /tmp/tapps-native-poc/bin/python deck-manager-bridge/poc/disk_restore.py \
  --pid ARENA_PID --resume /tmp/arena-disk-write-test \
  --output /tmp/arena-disk-recovery
```

Recovery without `--execute` fetches/verifies/archives the existing copy only.
With approval, `--execute` removes only that copy after durable fetched-data
read-back. Recovery checks the original archive hash, operation identity, original
roster and source, and unchanged named test snapshot. It has no create path. A
missing/changed copy, account/service change or uncertain result stops; this is
not a general production transfer journal. Detaching never deletes a deck.

## Checks and references

```sh
PYTHONPATH=src venv/bin/python -m pytest tests/test_native_deck_poc.py -q
node --check deck-manager-bridge/poc/probe.js
node --test deck-manager-bridge/poc/probe.test.cjs
```

Offline tests cover exact archival, incomplete captures, no overwrite/partial
publication, wrong PID refusal, interruption cleanup, and durable boundaries
before deleting a test copy. JavaScript tests cover the UI/service guards and
description normalization without accepting real card/cosmetic/metadata changes,
physical-summary reconstruction and IL2CPP thread ownership. Python tests cover
disk loading, large integers, durable fetched-data cleanup and recovery with no
create retries or targeting original IDs.
They never attach to the game.

References: [Frida API](https://frida.re/docs/javascript-api/),
[Unity dispatcher source](https://github.com/Unity-Technologies/UnityCsReference/blob/master/Runtime/Export/Scripting/UnitySynchronizationContext.cs),
[Enhancement Suite service/UI precedent](https://github.com/Beligal/MTGA-Enhancement-Suite/tree/2a0647cf40adde49686d1c0c8957c147114ccb9c/Plugin),
and [IL2CPP bridge](https://github.com/vfsfitvnm/frida-il2cpp-bridge).
This experiment uses independently written code; it does not vendor those implementations.
