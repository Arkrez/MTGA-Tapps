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

Not validated: native loader, process reader, account enumeration, authoritative
capacity, automatic create/delete, interruption reconciliation, native Arena
folder, Windows desktop packaging and macOS native adapter. No Arena deck was
created or deleted by this implementation or validation.
