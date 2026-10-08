# Deck Manager

Deck Manager is a local library for **any deck**, separate from Arena's active
roster and the dashboard's played-deck statistics. Open it from the sidebar or
tray/menu. There is no product-imposed deck-count limit in this library.

This branch now implements direct native backup, move and restore from the tracker,
including bulk selection. The integrated adapter has been verified with offline
tests; live validation of this integration is deferred while the user is playing.
The earlier live proof established native disk restoration. A persistent collection
category inside Arena remains separate work in [the implementation plan](plans/DECK_MANAGER.md).

## Direct Arena transfers

The initial adapter supports Apple Silicon macOS Arena using the tested Unity
`6000.3.14f1` runtime. Unsupported platforms/builds report that capability rather
than attempting a write. The pinned Frida dependency and adapter asset are included
in Mac source/package configuration; installed-bundle permissions still need live
validation. No Arena installation files or authentication tokens are changed.

Open Arena on **Decks** outside a match, then click **Connect to Arena**. The
**Arena** tab shows the current ordinary-deck roster from a successful refresh and
Arena's own deck-limit decision. A cached deck count is never subtracted from 100
to invent free slots. Clicking **Refresh Arena** reads again; simply opening or
polling the dashboard never attaches to Arena. A tracked active game blocks the
connection before attachment, and native writes also require the live Decks screen.

- **Back up all Arena decks** saves every ordinary deck in one job. Select individual
  tiles for **Back up selected**. This copies decks without removing them from Arena.
- Select one or several Arena decks and click **Move to collection**. The confirmation
  lists the selected decks. Each is saved with all four piles, printing IDs, quantities,
  summary metadata and cosmetics, then read back and compared before removal from
  Arena. Notes and earlier library revisions remain available.
- In **Saved**, select native backups for **Restore selected to Arena**, or open a
  deck/revision and use the yellow **Restore to Arena** button beside Close. This
  reconstructs the saved data and calls Arena's normal create service directly.
  It does not use the clipboard. Fresh capacity checks stop the batch when slots
  are full; move an active deck out first. Already-present decks cannot be restored
  again through the same binding.

Jobs run in the background, one transfer at a time, and stop on the first failure.
Completed transfers stay completed. The dashboard monitors progress, refreshes
the library/roster afterward and can resume monitoring a running job after a page
reload. Leaving Decks, changing accounts or losing the connection prevents further
writes. The tracker/game is never launched, stopped or restarted by this adapter.

Native backups are scoped to a hash of the authenticated account ID. A downloaded
native `.tappsdeck` can be restored on another computer signed into that same
account. A text-only/log-captured revision still has the clipboard export described
below; it is not silently substituted for an exact native restore. Editing a native
revision's cards/name/format without rebuilding its native model prevents restoring
stale data; select its original native revision or back up the edited deck from Arena.

Every move/restore has a committed SQLite intent before the native write. After an
interruption, use **Reconcile transfers**. This only reads Arena and checks the
recorded identities/data; it never repeats create/delete. Confirmed outcomes are
completed locally. An uncommitted removal is cancelled with both copies retained.
An uncertain restore that is still absent remains blocked because a late server
commit is possible. Changed/missing unrelated decks or mismatched restored data
require review. Pending transfers protect their local backups from permanent deletion.

## Save and view

- Use the orange **+ Add deck** button at the top right to open the import dialog.
  Paste an Arena decklist or open a `.txt` / `.tappsdeck` file and click **Save deck**.
  Names and formats are optional; duplicate names are allowed.
- Click **Save to collection** in Deck Finder or on a played deck's detail page.
  Historical lists represent submitted snapshots, rather than the complete current
  Arena roster. They may lack printing/cosmetic metadata.
- **Capture Arena lists** rescans the resolved Player.log. The tracker
  also captures new outgoing `DeckUpsertDeckV3` and `EventSetDeckV3` lists while
  running, independently of gameplay persistence. This includes any format.

Capture never reconstructs a deck from draws or opponent reveals. Summaries have
no card piles and are skipped. Lists remain labelled as captured requests or
submitted lists; their presence does not confirm a successful Arena save. Only
available piles are kept, including main, sideboard, commanders and companions,
plus raw deck-specific metadata. Missing piles are labelled **Available piles only**.
Unresolved card IDs are preserved and shown as `Card #ID`.

Search names, formats and tags in the full-page deck grid. It shows four columns
on wide screens, three at medium widths, and fewer on narrow screens, with all
rows available through normal page scrolling. Each tile shows its latest update
date; hover the date for its full timestamp. Click a tile to open a dialog with
the deck’s sections, notes and saved revisions. **Save an edited revision…**
starts from the selected list;
earlier snapshots remain available. The dialog supports Escape/backdrop dismissal,
keeps keyboard focus inside while open and returns focus on closing. Notes and
tags belong to the library entry.
The red **Move to trash** button asks for confirmation and affects only this local
entry; **Restore from trash** recovers
it. To remove it completely, open the **Trash** tab, click the deck and choose
**Delete permanently**. The confirmation names the deck and counts its saved
revisions. **Delete deck** removes that entry and all its revisions together;
it cannot be recovered from Trash. These actions do not remove a deck from Arena
or change game history. Existing backup files retain their copies, and importing
an old backup or capturing the deck again can add it back to the collection.

The local library works with Arena closed. Card artwork uses the dashboard's
existing online Scryfall image loader; saved lists remain readable offline.

## Restore and export

For revisions without native backup data, the yellow **Copy for Arena** button
beside the dialog's close button copies the selected revision. Open Arena's Decks screen and
click **Import** when an active slot is available. Slot availability and the
import result are controlled by Arena; the tracker does not report them as known.
On supported native builds, **Move to collection** frees slots after durable backup;
the manual export remains available for text-only revisions.

Original imported text retains its section headings and printing suffixes exactly.
A captured list without original portable text exports resolved card names;
Arena selects the printings/cosmetics for that text import. The copy notice
explains this limitation. An unresolved ID prevents copying an invented name.

**Download backup** writes a versioned `.tappsdeck` JSON file containing the exact
normalized saved list, original text when available, and captured raw metadata.
Open it later to create another library entry, or use it to save a revision of
an existing entry. It retains Arena IDs even when the card name cannot be resolved.
Native backups restore their captured metadata directly through the native adapter;
log/text snapshots lack the exact native model required for that path.
Text parsing accepts the English Arena headings Deck, Sideboard, Commander,
Companion and Maybeboard, including lists with no format or incomplete construction.
The library preserves a list without claiming current format legality.

## Persistence and backups

Migration 32 adds independent library tables in the tracker's selected `--db`:
`managed_decks`, immutable `managed_deck_revisions`, per-pile `managed_deck_cards`
and `managed_deck_bindings`. Log capture uses the observed Arena GUID to
group snapshots but writes no authenticated binding, account or presence claim.
Manual imports get independent local UUIDs. Repeated scans deduplicate snapshots
and retain the latest observed revision; a later explicit reversion can become
current without duplicating a stored snapshot.

Migration 33 adds `managed_deck_transfers`, the durable native journal, with one
pending operation per account. Native backups record authenticated bindings and
verified presence observations. Full backups carry the journal; merging skips
transfers and Arena bindings, since another machine's operation cannot be replayed.
Gameplay reset preserves these tables. SQLite uses full synchronization for native
archive and journal commits; no source deck is removed before archive read-back.

Gameplay reset preserves the library. `.tappsbackup` exports and restores carry
it; **Merge** unions verified immutable revisions, retains newer library metadata
and ignores copied Arena bindings. Hash/UUID conflicts abort the merge transaction.
Full restore replaces the library, with a safety backup and confirmation if decks
or revisions would be lost—even if both databases have zero games. Backups from
before Deck Manager have no library and can therefore replace it with an empty one.
Merge works for deck-only backups as well as game history.

Local writes validate the full list before persistence; a malformed card does
not produce a partial backup. The current input limits are 2 MB per import,
10,000 distinct entries and 50,000 total cards, rather than Arena's construction
rules. Gameplay tracking remains log-only. Native Deck Manager jobs explicitly
attach to the running client and call checked deck services on Unity's thread;
they never craft cards or copy Arena credentials. The proof scripts remain
development-only and are not loaded by the application.
