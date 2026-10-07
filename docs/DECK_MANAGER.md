# Deck Manager

Deck Manager is a local library for **any deck**, separate from Arena's active
roster and the dashboard's played-deck statistics. Open it from the sidebar or
tray/menu. There is no product-imposed deck-count limit in this library.

This branch implements local backups and manual restore. It does not yet add a
category inside Arena or automatically create/delete Arena decks. The remaining
native work and platform evidence are in [the implementation plan](plans/DECK_MANAGER.md).

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

The yellow **Copy for Arena** button beside the dialog's close button copies the
selected revision. Open Arena's Decks screen and
click **Import** when an active slot is available. Slot availability and the
import result are controlled by Arena; the tracker does not report them as known.
To free a slot today, first save/check the outgoing backup, then use Arena's own
delete controls. Deck Manager does not automate Arena deletion.

Original imported text retains its section headings and printing suffixes exactly.
A captured list without original portable text exports resolved card names;
Arena selects the printings/cosmetics for that text import. The copy notice
explains this limitation. An unresolved ID prevents copying an invented name.

**Download backup** writes a versioned `.tappsdeck` JSON file containing the exact
normalized saved list, original text when available, and captured raw metadata.
Open it later to create another library entry, or use it to save a revision of
an existing entry. It retains Arena IDs even when the card name cannot be resolved.
This file does not currently restore captured metadata directly into Arena.
Text parsing accepts the English Arena headings Deck, Sideboard, Commander,
Companion and Maybeboard, including lists with no format or incomplete construction.
The library preserves a list without claiming current format legality.

## Persistence and backups

Migration 32 adds independent library tables in the tracker's selected `--db`:
`managed_decks`, immutable `managed_deck_revisions`, per-pile `managed_deck_cards`
and reserved `managed_deck_bindings`. Capture uses the observed Arena GUID to
group snapshots but writes no authenticated binding, account or presence claim.
Manual imports get independent local UUIDs. Repeated scans deduplicate snapshots
and retain the latest observed revision; a later explicit reversion can become
current without duplicating a stored snapshot.

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
rules. No runtime loader, injection, process-memory write, wildcard crafting or
Arena credentials are involved in this implementation.
