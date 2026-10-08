# Native Deck Manager: live proof of concept

Date: 2026-10-07. Branch: `deck-manager`.

**The Mac native section, bulk capture, create/delete services and restoration
of one deck reconstructed from disk are demonstrated.** The restored duplicate
persisted across an Arena restart, matched the archived data and was removed.
The initial disk verification probe crashed Arena; recovery completed after
fixing an unsafe thread detach path. This does not establish production stability.
The user considers manual clipboard transfer insufficient: native transfer
feasibility is the gate for continuing this feature.

## What actually ran

| Check | Observed result |
| --- | --- |
| Runtime | macOS Steam Arena, arm64, IL2CPP, Unity `6000.3.14f1`; Frida `17.9.0` |
| Attachment | Attached to the existing process and detached; no restart, sudo, game-file installation, or signing change |
| Runtime cache | 187 cached decks; 94 classified non-net; all 187 had loaded contents |
| Capacity | Arena's `GetDeckLimit()` returned 100; `DeckLimitReached` returned false |
| Full-deck service | `GetFullDeck(Guid)` invoked on Unity's thread; promise done/successful; returned identity verified |
| Bulk archive | All 94 non-net cached decks saved in one pass to a separate private SQLite library; content hashes verified; zero gameplay rows or Arena bindings |
| Native section | Cloned native folder named **Tapps Collection (proof of concept)**; Starter Decks sibling 1, test sibling 2; active in hierarchy |
| Visual confirmation | User confirmed it appeared below Starter Decks |
| Removal | Automatic cleanup completed; follow-up frame found zero temporary test sections |
| Disposable-copy dry run | Independent summary/contents, new draft identity; source unchanged; all card piles and skins matched; no create/delete call |
| Live creation | `CreateDeck` completed successfully; returned ID was new; created cached card piles and skins matched the original |
| Live archive/delete | Actual created-copy snapshot fsynced/read back before `DeleteDeck`; only that new copy was targeted |
| Final reconciliation | Separate `ForceRefreshCachedDecks` promise done/successful; copy absent; all 187 original IDs present; all original piles/skins identical |
| Original non-net metadata | All non-net snapshots identical after treating null/empty descriptions as equivalent; source deck never removed |
| Disk reconstruction | Capture session detached; new attachment loaded the persisted archive and rebuilt typed model/physical summary; full draft snapshot matched before new ID/name assignment |
| Disk-restored creation | Exactly one new “Tapps Restore” duplicate created; actual identity/piles/skins verified and archived |
| Interrupted verification | Arena crashed after creation, before cleanup; no delete or repeated create request had occurred |
| Restart/recovery | User reopened Arena; fresh attachment adopted only the journaled new copy, successfully refreshed/fetched it and verified metadata, piles, printing IDs, quantities and skins |
| Disk-copy cleanup | Fetched copy durably archived, removed and absent after successful refresh; no second create request |
| Final whole-cache comparison | 187 original IDs present, no test copy; every original pile/skin identical; all original non-net snapshots identical with only null/empty description equivalence |

This demonstrates the local in-process route on the actual Mac client rather
than relying on a Windows mod's behavior. The section is empty: no library deck
tiles, transfer actions or persistent scene integration have been implemented.

The first UI attempts exposed Frida integer/callback argument mismatches and
the difference between old 32-bit and Unity 6 pointer-sized GC handles. Temporary
clones were identified and removed through the runtime. The final run verifies
the Unity 6 ABI before cloning and checks section absence after destruction.
Arena and the active tracker remained running during those initial UI/read tests.
Those tests
changed no saved decks; the subsequent write test created and removed only its
new disposable duplicate.

## Exact scope of the evidence

Cache counts are not a current authenticated roster, a user-slot count, or
proof that uncached/event-course decks can always be fetched. Complete cache
contents were available in this session; cold-cache fetching needs another test.
The observed non-net set was archived, not moved out of Arena.

Archive data retains printing IDs, quantities, Main/Sideboard/CommandZone/
Companions piles, card skins, attributes and raw summary metadata. The nullable
folder Guid is preserved as bytes rather than guessed. Numeric IDs are retained
even when display names are unresolved. Unsupported summary fields/piles fail
instead of silently creating a partial backup. The bulk capture establishes
snapshot archival fidelity. The subsequent separate single-deck experiment
establishes disk-to-Arena restoration for its tested deck.

The native conversion helper normalized the first in-memory draft's `IsFavorite`
attribute. Disk reconstruction now explicitly restores the physical summary.
Computed JSON properties (`IsFavorite`, format and date setters) are excluded:
their deserialization can rewrite raw attributes. Typed model JSON is retained
as text so Int64 style values never pass through JavaScript's numeric conversion.
The reconstructed draft is compared against its archived snapshot before creation.
No broad printing/cosmetics/format matrix has been run yet.

`CreateDeck(Client_Deck, String, Boolean)`, `DeleteDeck(Guid)` and
`ForceRefreshCachedDecks()` were exercised successfully in the live test.
Windows/other architectures, installed-app
permissions, shipping a loader and client-update compatibility are untested.

## Completed service and disk tests

[Experiment code and commands](../../../deck-manager-bridge/poc/README.md)
include a prepared, explicitly enabled disposable-copy test. It creates one
new clearly named duplicate, verifies/archives its actual server-result identity
and card data, deletes only that verified new copy, and refreshes the roster.
The original deck is never deleted. Unknown outcomes stop without retries.
Source, intent and created-copy snapshots are private, exclusive and fsynced;
disk failure before the archive check prevents deletion.

The user approved this disposable-copy test with “game is open - ready to go.”
The first attempt stopped before any writes because Decks was closed. After
the user opened Decks and replied “ready,” exactly one duplicate was created,
verified, archived, and targeted for deletion. The runner stopped during final
polling because it also required an active Decks selector for read checks.
No create/delete request was repeated. A cache check confirmed the copy absent;
a separate successful native roster refresh then confirmed all original IDs
and card data remained intact. The private journal ends with a reconciled result.

Refresh represented empty descriptions as null and updated net-deck display
names. All original non-net metadata matched after null/empty-description
normalization, and every original deck's printing IDs, quantities, piles and
skins matched exactly. Raw archive data remains intact. These cache changes
must not be confused with edits to the user's saved decks.

The experiment now allows read polling through a temporary Decks UI rebuild
while retaining the same-service identity check; actual create/delete still
require Decks open. Source verification allows only the observed equivalent
empty-description representation. Offline JavaScript tests verify those
boundaries and rejection of real card/metadata changes. This revised automated
polling path also completed the later disk-copy cleanup successfully.

The user then authorized disk restoration while on Decks outside a match. The
probe persisted a typed archive, detached completely, loaded the file in a new
attachment and reconstructed a new independent deck from those bytes. A dry run
verified the draft's complete snapshot. The live run created exactly one duplicate
and persisted its actual returned identity/data, then Arena crashed during the
verification stage, before any cleanup request.

The macOS crash report records a main-thread access fault. Inspection found a
probe path that could detach an already-attached, Arena-owned IL2CPP thread during
an asynchronous continuation. The probe now checks `thread_current`, detaches only
its own new attachments and avoids nested discovery in the verification path.
Offline tests exercise both thread ownership cases. The crash report alone does
not conclusively attribute the fault; broad reliability remains untested.

After the user reopened Arena and authorized continuing, `disk_restore.py --resume`
validated the original journal/archive digest and adopted only the already-created
copy. It cannot enter the create phase. A successful native roster refresh and
`GetFullDeck` returned that persisted copy; its full snapshot matched the expected
disk reconstruction, allowing only null/empty-description equivalence. The fetched
snapshot was fsynced/read back before removing that copy. Cleanup and final refresh
completed without a repeated create request. A separate read-only whole-cache
comparison confirmed every original ID, pile and skin, and all original non-net
metadata intact. The tracker was never stopped or restarted by the experiment.

This passes the **single-deck disk restoration feasibility gate**. It does not
yet demonstrate a stable end-to-end unattended run, arbitrary archived decks,
bulk transfers or a production recovery journal.

Production work first needs stable attachment/dispatcher behavior and wider
format/cosmetic coverage, then authenticated account/roster discovery, a durable
reconciliation journal, capacity-aware restore/swap, native tiles backed by the
same tracker library, scene lifecycle handling and supported platform packaging.
Do not expose native transfers in the dashboard before those gates are met.

Private runtime reports/databases are intentionally outside the repository.
No personal deck names, IDs, card lists, credentials or proprietary binaries
are included in this report. References and reproduction details are in the
experiment README; the tracker does not automatically attach to Arena.

Offline validation after the disk/recovery changes: full Python suite **826
passed, 1 skipped, 1 deselected, 5 subtests passed**; JavaScript probe tests **15
passed**; probe syntax and diff whitespace checks passed. UI was unchanged.
