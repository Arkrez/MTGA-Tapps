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
  return of focus/scrolling were checked. The early demo screenshots were
  retired when the final Deck Manager layout replaced them.
- Permanent local deletion was checked on a separate demo dashboard on port
  8877: open a disposable trashed deck, cancel confirmation, then confirm deletion.
  Trash became empty and the other 104 saved decks remained. Backend tests
  verify required Trash/confirmation, complete
  revision/card/binding cleanup with foreign keys enabled, rollback on failure,
  and preservation of another same-name deck and recorded game history. UI tests
  cover cancellation, failed deletion and disabled controls while deleting.
- Move to Trash now has its own confirmation. Browser checks covered cancellation,
  confirmation and recovery of a disposable demo deck, plus the yellow header Copy
  for Arena button and red Trash button at desktop and 390 px mobile widths.
  The mobile dialog has no horizontal overflow. Tests cover cancellation with a
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

## Matching tiles, status filters and Deck Finder direct add — 2026-10-08

- Arena tiles now reuse artwork from matching library bindings, including entries
  in Trash, or use their roster printing ID. Both tabs share 76px artwork and
  fixed 156px tile heights. Bottom-right colored pills describe location and backup
  type; pill clicks and a status selector filter alongside search and clear selection.
  An unconnected Saved list displays Not checked instead of guessing deck absence.
- Deck Finder exposes Add to Arena beside the renamed Copy for Arena action.
  Native status polling remains passive. Direct adds use a fresh connection and
  authoritative capacity check, Arena's text parser, exact pile/name/count checks,
  durable native archival, and the existing journaled restore/create path.
  Reduced/unresolved/unsupported-pile lists stop before any save request. No crafting
  calls are present. Request replay after interruption uses the existing binding
  and journal rather than preparing another deck; changed import inputs are rejected.
- After the user confirmed Decks outside a match, live native text preparation
  parsed exactly four Forests and produced a validated complete native archive.
  Roster IDs were equal before and after. No create, remove, crafting or queue call
  occurred. A first attempt stopped on the screen guard, and another revealed that
  ActiveLocProvider is a static field rather than a getter; metadata inspection
  established the checked field/type/namespace before the successful parser check.
- Full Python suite: **858 passed, 1 skipped, 1 deselected, 5 subtests passed**.
  The new preview-route permission test also passed separately. Full UI suite:
  **168 passed** across 21 files. After adding the completed-action button guard,
  the 10 Deck Finder tests, TypeScript, lint and production build passed again.
  Native JavaScript guards: **7 passed**; syntax and scoped Python style checks pass.
- Only the idle dashboard-only preview process was refreshed, retaining the same
  test database and last roster. Arena and the tracker/desktop app stayed running.
  Preview permits Deck Finder's read-oriented jobs and still rejects app settings,
  analytics restore/reset and companion launch routes. HTTP smoke checks verified
  the new CSS, provider list and native-add validation without creating any deck.

The text parser is live-verified; the complete Deck Finder add/create/verification
flow is implemented and offline-tested but awaits a user-selected runtime test.
Automated browser review of the new pill layout remains unavailable. Existing native
move/restore, persistent native collection/tiles, Windows and installed-app validation
remain as previously recorded; no additional Arena deck mutation was performed here.


### Collections, transfer progress and failed-import recovery — 2026-10-08

- A user-selected Finder list failed before CreateDeck because `sameSourceSnapshot`
  compared JSON text to a key-sorted SQLite archive. A read-only native reconstruction
  proved structural equivalence, JSON key-order inequality, an unchanged 94-deck roster
  and absence of the failed restore ID. No Arena create/delete was invoked.
- The comparison now canonicalizes object keys recursively, retaining array order and
  checking all values. Native restore preparation is separate from dispatch; preparation
  failures cancel safely, while a dispatched timeout still remains uncertain. An offline
  regression proves a sorted backup matches and changed quantities are rejected.
- SQLite online backup preserved the isolated preview DB before cancelling only this
  demonstrated pre-create failure. All 96 saved entries/revisions were retained. The
  active tracker database was read only, and Arena/tracker were not restarted.
- Migration 34, collection CRUD/membership, backup merging and gameplay-reset retention
  have regression coverage. Collection removal returns even trashed decks to Unsorted.
  Finder Save then Add upgrades the same saved entry with a native revision.
- Structured progress counts preparation/request/verification for transfers and reads /
  verified commits for bulk backups. UI tests cover grouping, collapse, collection
  confirmation, membership moves, Finder destination/identity and progress rendering.
- Full Python suite: **867 passed, 1 skipped, 1 deselected, 5 subtests passed**.
  Full UI suite: **172 passed**, 21 files. Native JavaScript: **8 passed**. TypeScript,
  lint and production build passed. Browser visual review remains unavailable.
- The shipped split preparation RPC also passed live for the failed deck, holding
  only a transient rebuilt draft. A second refreshed roster was unchanged; connection
  close released the draft without dispatching create or delete.
- The idle dashboard-only preview was refreshed with its existing isolated library.
  HTTP checks confirm 96 retained entries, 94 Arena decks, schema 34, no pending
  transfer, current collection/progress assets and a clean foreign-key check. The
  original tracker stayed running. No live native mutation was performed.
- Full native create/move verification still requires a user-selected live action.
  The persistent collection section inside Arena, Windows and installed-bundle validation
  remain unfinished; dashboard collections do not claim to implement native folders.

## Decks screen redraw and Windows enablement (2026-10-16)

Validated live on Apple Silicon macOS, Unity `6000.3.14f1`, with the user out of a
match on Decks:

- Read-only metadata and call tracing showed Arena's Decks screen rebuilds its grid
  through `DeckManagerController.Coroutine_LoadDecks(bucket, Guid?)` on open and after
  its own delete. Starting that routine once replaced the request, buckets and
  view-info list (181 decks); Arena stayed up. No deck was created or deleted.
- Passing a deck ID selected it (`Guid?` = HasValue byte, Guid at +4). Selection does
  not scroll; centering the tile via the `ScrollRect` on `DeckViewSelector` moved the
  grid to the bottom tile and, through the shipped `open`/`refreshscreen`/`close`
  exports, to a middle tile in 0.58 s. The user confirmed the scroll.
- One Arena restart during this session was the user's, not a probe crash.

Windows (x64) is enabled in code only. Its code paths share the macOS adapter
(IL2CPP exports, metadata lookups, `runtime_invoke`), with these platform points:
`GameAssembly.dll`, process `MTGA.exe`, Frida's `win_amd64` wheel and `ARENA_ARCH`
`windows: x64`. Before claiming Windows support, run on a Windows PC with Arena
(installed build, out of a match, on Decks), stopping at the first failure:

1. Settings shows direct transfers available; Deck Manager's **Load Arena decks**
   lists the roster. A refusal naming a different Unity build means Windows Arena
   is not on `6000.3.14f1`; record it and stop.
2. Note whether antivirus or Windows Security warns about the attachment.
3. **Back up** one Arena deck; open it in Saved and compare the list.
4. **Add to Arena** from Deck Finder (one free slot): the deck appears, is selected
   and scrolled into view without leaving Decks; its backup is the newest revision.
5. **Move to collection** for that new deck: it leaves the grid without reopening
   Decks, and the saved copy remains.
6. **Restore to Arena** from Saved, then open a deck in Arena and try Add again:
   the "Arena isn't on its Decks screen" message appears without script details.
7. Check the frozen app opens no console windows during these jobs.

## Windows setup and Mono runtime (2026-10-16)

First Windows 11 PC (Steam install), checked offline from the install files without
attaching: Unity `6000.3.14f1` matches, but Windows Arena is a **Mono** build — no
`GameAssembly.dll`, it loads `MonoBleedingEdge\EmbedRuntime\mono-2.0-bdwgc.dll` with
263 managed DLLs. The IL2CPP-only adapter would have stopped at load. Every Mono
export the new `monoRuntime()` shim uses is present, including Unity's pointer-sized
`mono_gchandle_*_v2`.

- `arena_decks.js` now selects IL2CPP or Mono and exposes the same helpers; the main-
  thread hook uses `mono_compile_method` for `UnitySynchronizationContext.Exec`.
  Archives record `runtime: Mono` on Windows; their JSON models are runtime-neutral.
- Windows setup fixes: the UI `node_modules` was an incomplete install (no rolldown
  binding); a clean `npm ci` fixed `npm run build`. Node 26's own `localStorage`
  global shadowed jsdom in vitest; the test setup restores jsdom's. Deck Finder
  needed Python 3.10+/3.11+ (`X | None`, `datetime.UTC`) despite `>=3.9`.
  `native_deck_bridge` read the adapter as cp1252, garbling `’` in its messages.
  POC scripts fsynced read-only handles/directories, which Windows rejects.
- Full Python suite on Windows (Python 3.9.13): **1032 passed, 3 skipped,
  1 deselected**. UI: **426 passed** in 49 files; TypeScript, lint and build pass.
  Native adapter: **28 passed** (9 new); POC: **15 passed**.
- **Step 1 passed live** (read-only, Arena on Decks, user-approved): connect 0.7 s,
  Unity `6000.3.14f1`, Decks screen detected, roster of **92 decks**, limit 100,
  same deck/summary fields as macOS. Arena stayed responsive; no deck was written.
  This confirms Mono type-name formatting, the `Exec` main-thread hook on JIT code,
  GC handles and the shared layout checks.
- The first live run listed a bogus pile `enumSeperator`: Mono's `System.Enum` declares
  that string constant and `fields()` walks parent classes, so `pileNames` read an
  8-byte reference into a 4-byte buffer. It now reads only members typed as
  `EDeckPile` (confirmed against `SharedClientCore.dll` metadata: values 0–4).
- Steps 2–7 (including all writes) remain for user-selected live runs.

### Deck Finder Add on Windows (same session)

The user's first Deck Finder **Add to Arena** failed with "access violation
accessing 0x0" before anything was journaled or saved (no transfer row, no saved
deck). Two Mono-only causes, both found with read-only live runs:

- Frida's default `exceptions: 'steal'` took a hardware fault that Mono uses for an
  implicit null check, aborting the managed call midway. Mono `runtime_invoke` now
  uses `exceptions: 'propagate'`; the same fault then surfaced as a managed
  `System.NullReferenceException`, and rejected calls now name the exception type.
- The real cause: the shim passed a pointer to the reference to
  `mono_field_set_value`, which takes reference values directly (only value types
  go by pointer). The draft's `Name` pointed into a scratch buffer, which produced
  the null fault and later a garbage string length. The same call sets `_summary`
  in restore preparation and `_loadDecksCoroutine` in the Decks redraw.
- After the fix, live and read-only: `prepareimport` parsed "4 Forest" into
  `[(1, [(12429, 4)])]` plus three empty piles with the requested name (521-char
  model), and `preparecreate` rebuilt and matched it. No create was dispatched;
  the drafts were released on close. Arena stayed responsive throughout.
- User-run Deck Finder **Add to Arena** then succeeded: create, polling, read-back
  verification and journal completion (transfer `complete`). The Decks redraw did
  not appear: Mono's invoke wrapper unboxes `Nullable<T>` arguments, so it needs a
  boxed Guid (or null) for `Coroutine_LoadDecks`, not IL2CPP's raw 20-byte struct.
  `nullableGuidArgument` now differs per runtime. A live display-only
  `refreshscreen` for the added deck then returned true in 1.2 s.
- Another user-selected deck stopped at the importer comparison (no create). The
  error now lists the differing cards and quantities so a missing card can be told
  apart from a name-resolution fault. The tracker resolves names from the only,
  current `Raw_CardDatabase` in the Steam install.
- User-run steps 5–6 then passed: Move to collection (`DeleteDeck`) removed the
  deck from the grid and kept its saved copy; Restore to Arena from Saved worked;
  Add with Arena off Decks showed the plain Decks-screen message. No security
  warning was reported (step 2).
- Deck Finder Add for a list naming "Kavaero, Mind-Bitten" stopped because Arena
  returned the owned Universes Beyond printing, named "Superior Spider-Man" by
  the card DB. `Cards.InterchangeableTitleId` links the two (158 pairs). The Add
  comparison now keys both names together; a read-only live run of the user's
  75-card list matched with pairing and reproduced the error without it.
- Remaining: step 7 and frozen-build checks need the installer from CI (no Rust,
  Inno Setup or PyInstaller on this PC); macOS IL2CPP regression smoke for the
  shared adapter changes.

Deck Finder: Moxfield and AetherHub returned Cloudflare 403 to every cloudscraper
Chrome profile from Python 3.9/OpenSSL 1.1.1n on Windows, while `curl.exe` and the
Firefox profile got 200 from the same PC. `CloudflareSession` keeps the Chrome
profile first and moves to Firefox (with its own User-Agent) on a Cloudflare 403;
both real scrapers returned 200 via Firefox.
