# Native Deck Manager: live proof of concept

Date: 2026-10-07. Branch: `deck-manager`.

**The Mac native section and bulk capture work on the tested running client.**
Automatic Arena create/delete and restoration from disk remain unverified.
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

This demonstrates the local in-process route on the actual Mac client rather
than relying on a Windows mod's behavior. The section is empty: no library deck
tiles, transfer actions or persistent scene integration have been implemented.

The first UI attempts exposed Frida integer/callback argument mismatches and
the difference between old 32-bit and Unity 6 pointer-sized GC handles. Temporary
clones were identified and removed through the runtime. The final run verifies
the Unity 6 ABI before cloning and checks section absence after destruction.
Arena and the active tracker remained running. Saved decks were never changed.

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
`ForceRefreshCachedDecks()` signatures are present. Their live write behavior
has **not** been exercised. Windows/other architectures, installed-app
permissions, shipping a loader and client-update compatibility are untested.

## Concrete next test

[Experiment code and commands](../../../deck-manager-bridge/poc/README.md)
include a prepared, explicitly enabled disposable-copy test. It creates one
new clearly named duplicate, verifies/archives its actual server-result identity
and card data, deletes only that verified new copy, and refreshes the roster.
The original deck is never deleted. Unknown outcomes stop without retries.
Source, intent and created-copy snapshots are private, exclusive and fsynced;
disk failure before the archive check prevents deletion.

The user approved this disposable-copy test with “game is open - ready to go.”
The first attempt stopped before draft preparation or any create/delete call:
Arena reported capacity available but zero active Decks selectors. A subsequent
read-only check confirmed the same state. No new test deck was created. The
test is awaiting the Decks screen being open outside a match; the existing
approval covers this test and does not need to be requested again.

If that succeeds, the next feasibility gate is actual archive reconstruction:
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
