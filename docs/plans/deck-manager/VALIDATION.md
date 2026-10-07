# Deck Manager branch validation

Validated 2026-10-06 from the isolated `deck-manager` worktree.

- Full Python suite: **793 passed**, one display-related skip, one prescribed
  environment-specific deselection and five passing subtests. Temporary HTTP
  server tests used loopback socket access; no live tracker was stopped.
- UI suite: **144 passed** in 21 files. TypeScript, ESLint and production build
  passed. Vite reports the existing single-bundle size warning above 500 kB;
  no build failure.
- Browser checked with a separate demo SQLite database and a separate dashboard
  on port 8876: arbitrary deck import, sideboard/printing display, local trash,
  recovery, revision save and section navigation. The screenshot contains demo
  lists and is stored beside this report.
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
