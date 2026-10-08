# Deck Manager branch validation

Validated 2026-10-06 from the isolated `deck-manager` worktree.

- Full Python suite: **797 passed**, one display-related skip, one prescribed
  environment-specific deselection and five passing subtests. Temporary HTTP
  server tests used loopback socket access; no live tracker was stopped.
- UI suite: **153 passed** in 21 files. TypeScript, ESLint and production build
  passed. Vite reports the existing single-bundle size warning above 500 kB;
  no build failure.
- Browser checked with a separate demo SQLite database and a separate dashboard
  on port 8876: arbitrary deck import, sideboard/printing display, local trash,
  recovery and revision save. The redesigned collection was checked with 104
  demo decks, four columns at desktop width, three at 1360 px and one at 390 px,
  with no horizontal overflow. Detail/import dialogs, import completion and
  return of focus/scrolling were checked. Preview, detail and mobile screenshots
  contain demo lists and are stored beside this report.
- Permanent local deletion was checked on a separate demo dashboard on port
  8877: open a disposable trashed deck, cancel confirmation, then confirm deletion.
  Trash became empty and the other 104 saved decks remained. `delete.jpg` shows
  the confirmation. Backend tests verify required Trash/confirmation, complete
  revision/card/binding cleanup with foreign keys enabled, rollback on failure,
  and preservation of another same-name deck and recorded game history. UI tests
  cover cancellation, failed deletion and disabled controls while deleting.
- Move to Trash now has its own confirmation. Browser checks covered cancellation,
  confirmation and recovery of a disposable demo deck, plus the yellow header Copy
  for Arena button and red Trash button at desktop and 390 px mobile widths.
  The mobile dialog has no horizontal overflow. `trash-actions.jpg` and
  `trash-confirmation.jpg` record the updated UI. Tests cover cancellation with a
  historical revision selected and retention of the deck when a Trash write fails.
- Read-only Player.log smoke check archived into an **in-memory** SQLite database:
  five distinct observed decks, 18 immutable revisions, zero rejected lists and
  zero game rows. No names, IDs or raw payloads were copied into this report.
  This is observed log coverage, not a complete Arena-roster claim.
- Unit/integration coverage includes lossless portable text and full JSON,
  malformed imports with no partial writes, unresolved IDs, empty lists,
  independent revisions/trash, repeated scans and newer reversions, preserving
  the tracker's connection settings, backup restore/merge, hash-conflict rollback,
  deck-only backup previews, older-backup loss confirmation, selected DB routing,
  HTTP request validation and stale UI responses.

At the initial local-library validation, not validated: native loader, process reader, account enumeration, authoritative
capacity, automatic create/delete, interruption reconciliation, native Arena
folder, Windows desktop packaging and macOS native adapter. No Arena deck was
created or deleted by that initial implementation or validation.

## Native transfer integration — 2026-10-07

The [live POC report](NATIVE_POC.md) records the subsequent real-client evidence,
including disk reconstruction, the verification crash and successful recovery.
The tracker integration is now implemented separately in `native_deck_bridge.py`,
`native_deck_archive.py`, `deck_transfers.py`, `deck_native_api.py` and the bundled
`assets/arena_decks.js`. Dashboard controls expose explicit single/bulk backup,
move, restore and reconciliation jobs. Migration 33 records durable intents.

- Full Python regression suite: **849 passed, 1 skipped, 1 deselected,
  5 subtests passed**.
- Full UI suite: **158 passed** across 21 files. TypeScript, lint and production
  build passed; the worktree's `ui/dist` is fresh.
- Native adapter and POC JavaScript boundary tests: **21 passed**; adapter syntax
  checks passed. New Python modules pass the scoped style check.
- Fake-Arena tests verify archive commit/read-back before removal, exact disk
  reconstruction inputs, new restore identity, full-slot/account/duplicate/scene
  guards, disk failure, external edits, interrupted commit reconciliation without
  another write, uncertain-absence blocking, request replay isolation, protection
  against permanent deletion of pending backups, portable account provenance,
  stale-model rejection and positive active-game blocking before attachment.
- UI tests cover passive status reads with no automatic job, bulk selection and
  move confirmation/cancellation, confirmed IDs only, background job monitoring,
  selected native revision restore without clipboard and full-slot/pending guards.
- No browser was connected for visual review of the new controls; the prior
  collection screenshots do not represent this new native toolbar.

The user explicitly requested no interruption while playing ranked. No Arena
attachment, runtime mutation, or game/tracker restart occurred after that instruction.
The integrated adapter has not been live-tested or activated in the running app.
Live validation is deferred until the user explicitly reports being out of a match
on Decks. Persistent native collection/tiles, Windows and installed-app permissions
remain unvalidated.

## Selection, bulk removal and isolated live testing — 2026-10-08

- Saved/Trash selection applies to every deck, including text imports and entries
  still in Arena. Checkboxes moved to the top right with a 24px control inside a
  separate 44px label. Shared toolbar styles cover the native action bars, including
  orange move, yellow restore and red local removal controls.
- Bulk Trash/permanent-delete confirmations list every selected deck. The API
  validates required confirmation and the complete selection under a write lock;
  deletion failure or a pending transfer rolls back the entire batch.
- Full Python suite: **852 passed, 1 skipped, 1 deselected, 5 subtests passed**.
  The two additional preview-isolation/game-guard tests passed separately, as did
  the expanded pending-backup protection test. Full UI suite: **163 passed** in
  21 files; TypeScript, lint and production build passed. The existing bundle-size
  warning remains. New controls have not received an automated browser review.
- After the user explicitly confirmed the ranked game had ended and Arena was on
  Decks, the integrated adapter completed a successful authoritative roster refresh:
  **94 ordinary decks**, native limit **100**, active Decks controller present.
  A subsequent integrated bulk backup saved all **94 native archives** into an
  isolated persistent test library. No Arena create/remove/move was called.
- `scripts/preview_deck_manager.py` runs a dashboard only on a separate port. It
  writes only the separate library, reads the already-running tracker's active-game
  row in SQLite read-only mode on every guard check, fails closed on missing status,
  and disables non-Deck-Manager POST routes. It launches no tracker or desktop app.
  Tests verify a game started after launch blocks connection, missing status fails
  closed, the tracker schema remains intact, and identical/aliased DBs are rejected.
- HTTP smoke checks verified all 94 library entries are native-restorable, their
  bound identities equal the cached Arena roster, and settings writes are rejected.
  A temporary text-only entry was imported, bulk-trashed and bulk-deleted through
  the live-test API. All 94 real backups remained; no real Arena deck was affected.

The live test dashboard is ready for user-selected moves/restores. Integrated
move/restore runtime validation, persistent native collection/tiles, Windows and
installed-bundle permissions remain pending. Neither Arena nor the existing
tracker/desktop app was restarted. The other working branch was not changed.
