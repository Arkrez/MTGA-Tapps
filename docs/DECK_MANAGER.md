# Deck Manager

Deck Manager is a local library for **any deck**, separate from Arena's active
roster and the dashboard's played-deck statistics. Open it from the sidebar or
tray/menu. There is no product-imposed deck-count limit in this library.

This branch now implements direct native backup, move and restore from the tracker,
including bulk selection. The integrated adapter has been verified with offline
tests, plus a live roster refresh and backup of 94 decks on 2026-10-08. Integrated
move/restore validation remains pending through the separate live test dashboard.
The earlier live proof established native disk restoration. A persistent collection
category inside Arena remains separate work in [the implementation plan](plans/DECK_MANAGER.md).

## Direct Arena transfers

The initial adapter supports Apple Silicon macOS Arena using the tested Unity
`6000.3.14f1` runtime. Unsupported platforms/builds report that capability rather
than attempting a write. The pinned Frida dependency and adapter asset are included
in Mac source/package configuration; installed-bundle permissions still need live
validation. No Arena installation files or authentication tokens are changed.

Deck Manager never stays connected to Arena. Each job (load, backup, move, restore,
add or reconcile) attaches, does its work and detaches. Open Arena on **Decks**
outside a match, then click **Load Arena decks** (top right; **Refresh Arena decks**
after the first read). The **Arena** tab shows the ordinary-deck roster from the
last successful read and Arena's own deck-limit decision. A cached deck count is
never subtracted from 100 to invent free slots. Simply opening or polling the
dashboard never attaches to Arena. A tracked active game blocks every job before
attachment, and native writes also require the live Decks screen.

One status panel above the search reports, in order of priority: a running job
with its progress; an interrupted transfer (with **Reconcile transfers**); a game
in progress ("Deck Manager won't touch Arena until the game ends", plus when the
Arena list was read); decks not loaded yet (with what to click); Arena not on the
Decks screen at the last read; otherwise when Arena was last read, its deck count
and slot limit. The last action's result or error appears in the same panel and
can be dismissed. While a dialog is open, its result shows in the dialog instead.

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
- In **Deck Finder**, **Add to Arena** parses the selected list with Arena's own
  importer, verifies that no card quantities or piles were dropped, saves a full
  native backup in your collection, and uses the same journaled create/verification
  path as restore. Arena must be on **Decks outside a match**, with a free slot.
  No previous connection click is required. Missing/unresolved cards or a reduced
  list stop before creation; the button never crafts cards. **Export to Arena**
  remains available for manual import. Arena's parser leaves Format and the deck tile
  empty, and Arena would then store the deck with format `""` and no art. The added
  deck's summary therefore gets the Format from the Deck Finder label (`Standard`; a
  Bo3 label selects `TraditionalStandard`/`TraditionalHistoric` and similar; Brawl
  labels map to `Brawl`/`HistoricBrawl`; unknown labels use `Standard`) and a tile:
  the most-played creature, else the most-played nonland card. Both are written to
  the serialized summary and the snapshot together, so preparation rebuilds the deck
  through the same path a restore uses. The parser's draft lacks the bookkeeping that
  `CreateDeck` adds (Version, TileID, LastPlayed, IsFavorite and cosmetic defaults),
  so a new deck is verified by identity, name, format, piles and styles; Arena's stored
  copy then becomes the newest revision, and later moves compare exactly.

Jobs run in the background, one transfer at a time, and stop on the first failure.
Backups and bulk moves/restores show **Stop** at the top right. After a warning, the
job stops between decks: an Arena request already sent always finishes and is
verified, decks already read for a backup are verified and saved, and the remaining
decks are left as they are. Saved text or captured decks show **Add to Arena** in
their dialog, which uses Arena's importer like Deck Finder; so does a deck whose only
native data is an unfinished import draft.
The progress bar uses completed preparation, request and verification steps, reaching
100% only after verification. Bulk backups count reads and verified disk saves.
Connecting uses an indeterminate bar.
Completed transfers stay completed. The dashboard shows a transfer progress bar, refreshes
the library/roster afterward and can resume monitoring a running job after a page
reload. Leaving Decks, changing accounts or losing the connection prevents further
writes. The tracker/game is never launched, stopped or restarted by this adapter.

Arena runs adapter code only on its main thread, one frame at a time, and each
frame can take 30–100 ms while Arena is in the background, so the adapter does as
much as it can per frame. A request Arena answers from its cache is checked in the
frame that started it; only pending requests are polled. Backups read up to five
decks per frame (`BACKUP_BATCH`, also the Stop granularity). Discovery looks up the
classes it needs by name and falls back to scanning every class only if one is
missing; field and method metadata are cached for the attachment. Each job prints
its cumulative phase timings (attach, roster, reads, total; never deck names) to
the tracker console as `Deck Manager <action> timings`.

Native backups are scoped to a hash of the authenticated account ID. A downloaded
native `.tappsdeck` can be restored on another computer signed into that same
account. A text-only/log-captured revision still has the clipboard export described
below; it is not silently substituted for an exact native restore. Editing a native
revision's cards/name/format without rebuilding its native model prevents restoring
stale data; select its original native revision or back up the edited deck from Arena.

Every move/restore has a committed SQLite intent before the native write. Rebuilding
and checking a restored deck is a separate preparation step; failures there cancel
locally because no create call was dispatched. Snapshot comparisons ignore object
key order while retaining all values, array order and the observed empty-description
equivalence. After an
interruption, use **Reconcile transfers**. This only reads Arena and checks the
recorded identities/data; it never repeats create/delete. Confirmed outcomes are
completed locally. An uncommitted removal is cancelled with both copies retained.
An uncertain restore or add whose deck is present is completed: its identity is
derived from the transfer, so only that transfer could have created it. If the deck
was edited in Arena afterwards (renamed, format, art, styles), Arena's current copy
is saved as the newest revision and the original revision is kept.
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
date; hover the date for its full timestamp. Saved and Arena tiles use the same
height and artwork size. Arena uses the matching saved artwork when available,
or its roster's selected printing ID; the shared loader retains its fallback.
Mana pips under each tile's artwork show the deck's colors, from the main deck and
commander (never the sideboard) scored like the Overview's deck colors: lands count
for every color they produce, spells for the colors their costs strictly require,
and a color needs a few cards' weight to show. Colors come from Arena's local card
database, read once and cached for ten minutes, by printing ID or, for text lists,
by card name; a deck with no known cards shows no pips.
Bottom-right colored pills identify **In Arena**, **Collection only**, **Not
checked** or **In Trash**, and the backup type. Arena shows **Backed up** when a
full native backup is present in Saved, otherwise **Not backed up**. **Full backup**
means printing IDs and native metadata were saved; it does not mean the deck is in
Arena. **Text backup** describes a saved text list. Click a pill
or use the status selector to filter, alongside the existing text search.
Click a saved tile to open a dialog with
the deck’s sections, notes and saved revisions. **Save an edited revision…**
starts from the selected list;
earlier snapshots remain available. The dialog supports Escape/backdrop dismissal,
keeps keyboard focus inside while open and returns focus on closing. Notes and
tags belong to the library entry.
Each selection checkbox is in the top right of the tile, with a larger click
target separate from the details button. Select any saved decks, or use **Select
all** for the current search, then **Move selected to trash**. The confirmation
lists every selected deck. This includes text imports and backups of decks still
in Arena; native restore requires all selected entries to be native backups that
are absent from the connected roster. Changing the search or tab clears selection.
In **Trash**, **Delete selected permanently** also lists the full selection before
confirmation. Bulk removal is atomic: a missing/changed deck or protected pending
transfer prevents partial deletion.

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

## Test alongside another branch

Use a separate `deck-manager` worktree, its built `ui/dist`, and a dashboard-only
server. `scripts/preview_deck_manager.py` accepts `--db` for a separate persistent
deck library, `--tracker-db` for the existing tracker's database, and `--port`
(default 8880). Set `PYTHONPATH=src` in the feature worktree when using an interpreter
whose editable installation points to another checkout.

This starts no second tracker. Playing a game continues to write analytics only
through the existing tracker. The preview reads its live-game row using read-only
SQLite connections, blocks native attachment during a game, and fails closed if
the game guard cannot be read. Deck Manager writes and Deck Finder's read-oriented
fetch/hydrate/variants/surprise jobs are permitted from this test server; app
settings and analytics restore/reset are disabled.

Local imports, revisions and Trash affect the separate test library. **Connect**,
backup, move and restore use the real running Arena client: a confirmed move removes
the selected real deck after backing it up, and restore recreates it from the test
library. Keep that library for as long as you need its backups. The library remains
usable with Arena closed; connecting and transfers require Decks outside a match.

## Collections

Use **New collection** to create a named group, such as Control, Brawl or Blue decks.
Groups are collapsible; search and status filters work across them. Each saved deck
belongs to one collection, with existing and unassigned decks in **Unsorted**.
Select decks, choose a destination and click **Move decks**, or change **Collection**
in a deck's dialog. Imports and Deck Finder can also choose a destination.

The pencil renames a collection. Its remove button asks for confirmation, then moves
all members to Unsorted, including decks currently in Trash. It retains every deck
and revision and makes no Arena request. Collections remain usable with Arena closed.
Saving a Deck Finder list and then adding it to Arena upgrades the same entry with
a full native revision, preserving its collection, notes and earlier text revision.

## Restore and export

**Copy deck list** in the deck dialog's header copies the selected revision as Arena
import text (with exact printings for full backups). Open Arena's Decks screen and
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

Migration 33 adds independent library tables in the tracker's selected `--db`:
`managed_decks`, immutable `managed_deck_revisions`, per-pile `managed_deck_cards`
and `managed_deck_bindings`. Log capture uses the observed Arena GUID to
group snapshots but writes no authenticated binding, account or presence claim.
Manual imports get independent local UUIDs. Repeated scans deduplicate snapshots
and retain the latest observed revision; a later explicit reversion can become
current without duplicating a stored snapshot.

Migration 34 adds `managed_deck_transfers`, the durable native journal, with one
pending operation per account. Native backups record authenticated bindings and
verified presence observations. Full backups carry the journal; merging skips
transfers and Arena bindings, since another machine's operation cannot be replayed.
Migration 35 adds `managed_deck_collections` and nullable `managed_decks.collection_id`.
Backup merge maps collection membership and combines collections with equal names.
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
