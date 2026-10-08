# Native Deck Manager: live proof of concept

Date: 2026-10-07. Branch: `deck-manager`.

**The Mac native section, bulk capture, and create/delete services work on the
tested running client.** Restoration by reconstructing a deck from disk remains
unverified. The disposable-copy test completed after read-only reconciliation
of a temporary Decks-screen rebuild during its final polling stage.
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

This demonstrates the local in-process route on the actual Mac client rather
than relying on a Windows mod's behavior. The section is empty: no library deck
tiles, transfer actions or persistent scene integration have been implemented.

The first UI attempts exposed Frida integer/callback argument mismatches and
the difference between old 32-bit and Unity 6 pointer-sized GC handles. Temporary
clones were identified and removed through the runtime. The final run verifies
the Unity 6 ABI before cloning and checks section absence after destruction.
Arena and the active tracker remained running. These initial UI/read tests
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
instead of silently creating a partial backup. This proves local disk round
trip fidelity of the captured snapshot, **not disk-to-Arena restoration**.

The native conversion helper normalized the draft's `IsFavorite` attribute.
A production restore constructor must explicitly preserve/reapply required
metadata instead of assuming client conversion/export helpers are lossless.
No broad printing/cosmetics/format matrix has been run yet.

`CreateDeck(Client_Deck, String, Boolean)`, `DeleteDeck(Guid)` and
`ForceRefreshCachedDecks()` were exercised successfully in the live test.
Windows/other architectures, installed-app
permissions, shipping a loader and client-update compatibility are untested.

## Completed write test and remaining gate

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
polling path has not been exercised in another live write test.

The next feasibility gate is actual archive reconstruction:
capture → reconstruct **from saved data** → create disposable deck → fetch and
compare every pile/printing/cosmetic → remove only the disposable deck. Only
after this succeeds should production store/restore and bulk transfers proceed.

Production work then needs authenticated account/roster discovery, a durable
reconciliation journal, capacity-aware restore/swap, native tiles backed by the
same tracker library, scene lifecycle handling and supported platform packaging.
Do not expose native transfers in the dashboard before those gates are met.

Private runtime reports/databases are intentionally outside the repository.
No personal deck names, IDs, card lists, credentials or proprietary binaries
are included in this report. References and reproduction details are in the
experiment README; the tracker does not automatically attach to Arena.
