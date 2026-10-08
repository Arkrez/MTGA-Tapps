# Replay: watch any recorded game on a 3D table

Status: phases 0–3 built 2026-10-07 (contract in `docs/REPLAY_FORMAT.md`; delivered
behavior is summarized in `CHANGELOG.md` and `AGENTS.md`). Remaining: video export
(phase 4), the overlay button, and validation on real recorded games once the new
tracker build has tracked live games. Measured capture cost: about 34 KB per game. Researched 2026-10-06 against current
source and a read-only inspection of the local analytics database
(1108 games, 121,500 `game_events` rows, 285,661 `console_logs` rows).
Revised the same day after review: three.js renderer, one enriched event
stream instead of a separate recorder, table and sleeve colors.

Revised 2026-10-07 after first use: sidebar links work from the player
(section links on non-dashboard routes now change the hash); the table's
width follows the stage so its depth binds (cards about twice as large);
Arena-style two-tier rows per seat with clear gaps; piles in a left lane;
a large DOM stack preview on the right with curved, sleeve-colored
targeting arrows; a collapsible Actions panel; "Table" renamed "Replay
Options". Screenshots: `replay/scene-*.png`.

Reference: [the video that inspired this](https://youtu.be/jq6p4tMnchs?t=230)
shows a "Watch the match" prompt at game end, then a 3D world with each
player's deck, hand, graveyard and exile piles, the battlefield, and a
video-player style turn timeline. This plan delivers the same idea inside the
existing dashboard: web-based, OS-agnostic, built from the tracker's own data,
and available for games played before the feature existed.

Layout mockups (layout and controls only, not the final art):
`replay/mockup.html`, rendered as `replay/mockup-desktop.png` and
`replay/mockup-mobile.png`. The real page renders in WebGL with Scryfall
card images; the HUD uses the dashboard theme tokens.

## Recommendation in one paragraph

Add a **Replay** page at `#/replay/<game_id>` that plays a game forward on a
three.js table with real card images, an action log beside it, and a scrub
bar segmented by turn. There is **one event stream**: the existing
`game_events` table, enriched so every row carries instance ids, Arena ids
and zones, plus silent rows for things the console never printed (taps,
counters, tokens, blocks, attachments). The dashboard turns those rows into a
versioned replay JSON. Games recorded before the enrichment get a
best-effort replay reconstructed from their text rows and are labelled as
such. "Watch replay" appears everywhere a finished game is shown, including
the console summary. The table felt and each player's sleeves are
user-selectable colors. Video export is a second release on the same scene.

## Decisions made in review (2026-10-06)

### 1. Renderer: three.js, not CSS 3D

CSS 3D was the low-risk first draft. three.js through `@react-three/fiber`
(with `@react-three/drei` helpers) is the better fit for where this feature
is going, and the review chose it. What that buys and costs:

| | three.js (chosen) | CSS 3D transforms |
| --- | --- | --- |
| Look and feel | Real lighting, soft shadows under cards, felt material, glow on attackers, particle or shader effects later, smooth camera moves and presets. | Flat perspective transforms; no lighting or shaders; effects limited to CSS. |
| Video export | The scene is already a canvas: `canvas.captureStream()` plus `MediaRecorder` records exactly what the viewer sees. | A DOM scene cannot be captured; export would need a second renderer. |
| Card text | Cards are textured quads. Scryfall `normal` (488×680) is crisp at table scale; `large` (672×936) for the zoomed inspect view. Anisotropic filtering keeps tilted text readable. | Native DOM images, crisp at any zoom. |
| Hover and click | Pointer events via raycasting; the existing `CardLink` preview renders as a DOM overlay positioned from the projected card position. | Native. |
| Bundle | About 600 KB gzipped for three plus fiber plus drei. Loaded only on the replay route through `React.lazy`, the app's first code-split boundary. | None. |
| Images from Scryfall | Verified 2026-10-06: `api.scryfall.com` and `cards.scryfall.io` both send `Access-Control-Allow-Origin: *`, so textures load with `crossOrigin="anonymous"` and the canvas stays exportable. | Not applicable. |
| Testing | Scene-graph construction (`layout.ts`) is pure and unit-tested; the WebGL canvas is checked by Playwright screenshots, like the overlay. | jsdom can render it. |

The HUD (life totals, turn chip, action log, scrub bar, controls) stays DOM.
Only the table, cards, piles and stack live in WebGL.

### 2. One event stream, not a separate recorder

The first draft proposed storing trimmed copies of Arena's raw game-state
messages per game and interpreting them when a replay is watched. The two
options, in plain terms:

- **Interpreted events (chosen).** The tracker already decides what happened
  as it reads the log ("Amalia moved from the stack to the battlefield") and
  prints a line. That decision becomes the stored event, with the ids the
  tracker already has in hand. One table, one vocabulary, one pipeline.
- **Trimmed raw messages.** Store Arena's own description of each step and
  decide what happened later. Its only real advantage: if the tracker
  misreads something today, fixing the reader fixes every stored game. Its
  costs: a second storage path, roughly 100–150 KB per game, and a second
  interpreter duplicating logic the tracker mixins already contain.

Review chose the single stream, and the duplication argument is right. The
one risk it carries is that **anything the tracker does not record at capture
time is not recoverable for that game** (Arena keeps only `Player.log` and
`Player-prev.log`, so re-import is a short window). The plan manages that
with:

- A per-game `replay_version` stamp. Version 1 is the vocabulary below; a
  later version that adds, say, loyalty counters makes older recorded games
  show "loyalty not captured for this game" instead of a wrong board.
- Capturing the full vocabulary from the start, including events the
  console never prints, so the common cases are complete on day one.
- Fixture tests built from real logs for every event kind.

**What changes in the tracker.** `game_events` already has
`event_subtype, source_card_id, target_card_id, amount, zone_from, zone_to,
payload_json`, all NULL today because `_record_game_event`
(`tracker_analytics.py:1147`) receives only the printed text. The mixins
that already understand each event (`tracker_zone_transfers.py`,
`tracker_stack.py`, `tracker_combat.py`, `tracker_event_life.py`,
`tracker_event_turns.py`, `tracker_state_lookup.py`) pass a structured
`ReplayFact` alongside the text, and a new `_record_silent_event` writes rows
that have no console line. The console, the Game Detail timeline and the Live
Scoreboard filter on `visible = 1`, so nothing the user sees today changes.

Migration 31 (additive):

| Column | Meaning |
| --- | --- |
| `game_events.object_id`, `target_object_id` | Arena instance id, root after `ObjectIdChanged` (the tracker's `instance_roots`). Present for hidden cards too, so hand and library counts stay exact. |
| `game_events.arena_id` | grpId of the acting object. Gives Scryfall images by Arena id and token identity. |
| `game_events.controller_seat` | Controller at event time. |
| `game_events.visible` | 1 = printed line (default for all existing rows); 0 = replay-only. |
| `games.replay_version` | NULL for games recorded before the enrichment; 1 for the vocabulary below. |

Existing columns get filled: `event_subtype` = reason (`draw`, `play_land`,
`cast`, `resolve`, `destroy`, `exile`, `sacrifice`, `discard`, `mill`,
`bounce`, `counter`, `sba`, `put`, `token_create`, `token_cease`),
`zone_from`/`zone_to`, `amount`, `source_card_id`/`target_card_id`
(`cards.id`), and `payload_json` for lists (untapped ids, block pairs,
counter type and total, attach target, new identity).

Vocabulary version 1, with the annotation each comes from. Items marked
*new* are currently in the ignored set at `tracker_events.py:44-68` or are
not recorded at all:

| Event | Source | Today |
| --- | --- | --- |
| turn, phase, step | `turnInfo` | printed (turn); phase/step become silent rows so the stale-step problem goes away |
| life | `players[].lifeTotal` | printed |
| mulligan, opening hand | existing capture | tables |
| move (every zone transfer, hidden or visible, with ids) | `ZoneTransfer` annotations and object snapshots | printed for visible cards; resolution-to-battlefield and instants-to-graveyard *new* as silent rows |
| tap / untap (batched per message) | `TappedUntappedPermanent` | *new* |
| counter | `CounterAdded` / `CounterRemoved` | *new* |
| pt | `PowerToughnessModCreated`, object snapshots | *new* |
| token_create / token_cease | `TokenCreated` / `TokenDeleted` | counted only; *new* as events |
| attach | object `attachedTo`/`parentId` changes | *new* |
| identity (transform, copy, face-down) | existing `_maybe_log_identity_change` | printed as text; gains ids |
| stack push / resolve / fizzle / countered, with stack order | `tracker_stack.py` | printed; gains stack ids |
| attack, block, damage, targets | `tracker_combat.py`, `PlayerSubmittedTargets` | attack printed; blocks and targets *new* |
| scry, reveal, shuffle | existing library events, `Shuffle` | partly |
| game_end | existing lifecycle | games row |

Cost: a game today writes a few hundred rows; version 1 roughly doubles that
(untaps are one row per untap step, not one per permanent). Each row is one
insert on the tracker thread, the same path the console already takes, so no
new write pattern is introduced.

### 3. Historical games and the "replay compatible" flag

No game recorded so far has ids in its rows; the structured columns were
never written. So the choice for old games is not "ids or no ids" but
"reconstruct from the text or show nothing". The text was machine-generated
by the tracker, so it parses reliably for the visible things: turns, life,
draws, lands, casts, resolutions, removal, attacks, combat damage. It cannot
give blocks, taps, counters, tokens entering, or which of two same-named
copies did something.

Plan: every game shows one of three states.

| State | When | What the user sees |
| --- | --- | --- |
| **Recorded** | `replay_version` is set | Full board. Badge "Recorded". |
| **Reconstructed** | older game with `game_events` rows (1096 of 1108 locally) | Full page, approximate board. Badge "Reconstructed from the event log" with a tooltip listing exactly what is missing. Inferred objects (a token first seen when it attacks, a same-name pick) draw with a dashed edge and an "inferred" tag; hiding them would make the board visibly wrong. |
| **Not available** | games without events, mid-game attaches, untracked modes | The button is disabled with the reason. |

### 4. Backups

The earlier backup question only existed because of the separate raw-message
table. With one stream, replays are the `game_events` rows, which
`.tappsbackup` export, restore and merge already carry. Nothing to decide.

### 5. Table colors and sleeves (added in review)

- **Felt color** is a user preference with a small palette of pool-table
  cloths: green (default), blue, burgundy, charcoal, camel, purple. Rendered
  as a `MeshStandardMaterial` with a procedurally generated noise normal map
  (no bundled textures, no third-party art).
- **Sleeves** are the card backs, generated at runtime on a canvas: a plain
  color with a subtle geometric pattern and a thin border. Your default is
  deep blue, the opponent's default is dark red, each pickable from the same
  palette so they always differ at a glance. No Wizards artwork anywhere.
- Preferences live in `localStorage` under `mtga-replay-prefs` (per viewer,
  like the dashboard theme) and are edited from a "Table" popover on the
  replay page. If they should follow the user between machines they can move
  into `settings.json` later; the popover does not change.

### 7. No mobile; top-down is a first-class camera

Review decided that replay is not a phone feature: below 900 px (smaller than
a tablet) every replay link is hidden and the replay page shows a short
notice instead of the canvas. Phase 3's "mobile layout" item is dropped.

The three.js scene offers two camera presets. `table` is a mild tilt (30°,
lowered from 35° so the table fills more of the canvas) with soft perspective; `topdown` is orthographic. Both draw the same
textured quads, so neither is cheaper to render; the choice is purely visual
and the default can flip to top-down after a look at both.

### 6. Storage impact (measured 2026-10-06)

Measured with SQLite's `dbstat` on the local database (132.7 MB, 1108 games,
about 120 KB per game in total):

| Table | Today | Per game |
| --- | --- | --- |
| `game_events` rows | 35.2 MB | 31 KB |
| `game_events` indexes | 14.4 MB | 13 KB |
| `console_logs` rows + index (same lines, kept for the live feed) | 56.0 MB | 49 KB |

A `game_events` row costs about 290 bytes on disk although its text averages
64 bytes: the rest is the four long string ids (`session_id`, `match_id`,
`game_id`, `participant_id`, together about 140 characters) plus timestamps
and the indexes. That shapes how the silent rows should be stored:

- Silent rows carry `game_id` only; session, match and participant are
  derivable from the game row and the seat column. Untaps are one row per
  untap step with the ids in `payload_json`, not one row per permanent.
- Expected: about 110 silent rows per game at roughly 120 bytes, plus index
  entries, plus six small integer columns on the existing rows.

| | Per game | 1000 games |
| --- | --- | --- |
| Version 1 capture, lean rows (planned) | about +20 KB (+17%) | about 20 MB |
| Same rows with the full id set (avoided) | about +40 KB (+33%) | about 40 MB |
| Separate raw-message table (rejected) | about +150 KB | about 150 MB |

Phase 2 verifies the figure with `dbstat` before and after importing the
same `Player.log`, and the acceptance bar is 25 KB per game.

## What the stored data can and cannot do today

| Source | Useful for replay | Missing |
| --- | --- | --- |
| `game_events` (1096 of 1108 games) | Every printed console line with `event_type` (style name), `turn_number`, `phase`, `step`, `elapsed_seconds`, `event_time`, and both life totals after each line. Text is regular because the tracker generated it: `You: cast [Name (Creature 2/2)]`, `Opponent: [Name] was destroyed`, `You attacking [opponent] with [Name (1/1)]`, `Stack: [Name] [resolved]`, `returned [Name] to hand`, `milled [Name]`, `drew [Name]` / `drew a card`, `scried 2 — kept […] on top`. | `event_subtype`, `source_card_id`, `target_card_id`, `amount`, `zone_from`, `zone_to`, `payload_json` are NULL in every row. No instance ids. `step` goes stale. Blocks are effectively never persisted (0 rows). Tokens entering, counters, tap state, attachments, instants reaching the graveyard and permanents entering on resolution are implied, never stated. 199 rows still name `Card #N`. |
| `console_logs` | Same lines plus headers; no `game_id` column. | Nothing structural beyond `game_events`. |
| `raw_game_payloads` | Nothing. It archives only `unknown`/connection entries; GRE traffic is never stored (`tracker_lifecycle.py:279-290`). Pruned after 30 days. | Historical GRE messages are gone. |
| `game_opening_hand_cards`, `game_mulligan_hands`, `game_drawn_cards` | The player's kept hand, each mulligan hand, and visible draws with turn numbers. | Opponent hand contents (hidden information). |
| `game_deck_cards` | The submitted decklist with `arena_id` (newer games only). | — |
| `game_turns` | Exact or recovered turn timings per seat. | — |
| `participants`, `participant_commanders`, `games` | Seats, names, decks, life, who went first, mulligans, commanders, outcome. | — |
| `cards` | Name, `arena_id` (sparse), `primary_type`, parsed P/T, colors, mana cost. | Token flags, set and collector number. Arena's local card DB has `GrpId`, `ExpansionCode`, `CollectorNumber`, `Types`, `Subtypes`, `Power`, `Toughness`, `IsToken`; `card_database.py` can expose them. |

## Architecture

### The replay stream

`src/mtga_tracker/replay_stream.py` defines the versioned JSON the page
consumes. The dashboard builds it from `game_events` rows (recorded games)
or from the text reconstructor (older games); the page has one reducer.

```
{
  "version": 1,
  "fidelity": "recorded" | "reconstructed",
  "replay_version": 1 | null,
  "limitations": ["Blocks and counters were not recorded for this game."],
  "game": {"id", "started_at", "format", "best_of", "outcome", "outcome_reason",
           "winner_seat", "total_turns", "duration_seconds"},
  "seats": {"1": {"role": "player", "name", "deck_name", "starting_life",
                  "went_first", "commanders": []}, "2": {...}},
  "cards": {"<card_key>": {"name", "arena_id", "type_line", "primary_type",
                           "power", "toughness", "mana_cost", "color_identity",
                           "is_token", "faces": []}},
  "turns": [{"turn", "seat", "first_seq", "last_seq", "started_at", "duration_seconds"}],
  "events": [{"seq", "t", "turn", "phase", "step", "kind", "log", ...}]
}
```

Event kinds mirror the vocabulary table above: `game_start`, `game_end`,
`turn`, `phase`, `life`, `mulligan`, `move`, `tap`, `untap`, `counter`,
`pt`, `attach`, `identity`, `stack_push`, `stack_resolve`, `stack_fizzle`,
`stack_countered`, `attack`, `block`, `damage`, `reveal`, `scry`, `note`.
Zones are `library`, `hand`, `battlefield`, `graveyard`, `exile`, `stack`,
`command`, `unknown`. Object ids are Arena root instance ids in recorded
replays and synthetic `r:<n>` ids in reconstructed ones. Hidden cards are
real objects with `card: null`. `log` carries the action-log line with the
same card-name segments the Game Detail timeline uses today.

**Hindsight hand (recorded games):** because the whole game is known, an
opponent card drawn on turn 3 and cast on turn 6 shares one object id, so the
page can show it face-up in hand from turn 3. Toggle, default on.

### Builder for recorded games

`replay_builder.py` reads one game's rows in a single query, orders by
`event_time, id`, maps rows to stream events, assigns stack ids, and derives
`turns` from `game_turns`. It never queries per event. Card metadata comes
from `cards` plus `game_deck_cards`, with `card_database.py` filling token
flags and set/collector numbers when Arena's DB is present.

### Reconstructor for older games

`replay_reconstruct.py` turns `game_events` text plus the supporting tables
into the same stream. It is deterministic, pure (rows in, stream out), and
tested against fixtures exported from the real database.

- **Grammar:** one regex per sentence shape present in the data, keyed by
  `event_type`. Unmatched lines become `note`.
- **Zone tracking:** per seat, a multiset of named objects per zone. A cast
  goes hand → stack; its `[resolved]` line sends a permanent to the
  battlefield and an instant or sorcery to the graveyard (type from the
  bracketed suffix, else `cards.primary_type`). `stack_fail` and `counter`
  send it to the graveyard. Removal picks any same-named battlefield object.
- **Seeding:** the player's library is the submitted decklist minus the kept
  hand (or deck size minus seven); hands and mulligans come from their
  tables; the opponent starts with seven hidden cards and `deck_size` hidden
  library cards. Opponent hand count = 7 + draws − plays − discards, clamped.
- **Life** always comes from the `player_life`/`opponent_life` columns.
- **Inference is marked:** tokens first seen when they attack or die are
  created at that moment with `inferred: true`; `Card #N` becomes a hidden
  "Unknown card".

### Dashboard API

- `GET /api/replay?id=<game_id>` returns the stream, following the
  `/api/game` template at `dashboard.py:6365-6403` (query-style id, 400/404,
  `cached_response`). It uses the builder when `games.replay_version` is set
  and the reconstructor otherwise.
- `game_detail` and list rows gain `replay: {"state": "recorded" |
  "reconstructed" | "unavailable", "reason"}` so every list can show the
  right button without an extra request.
- The timeline query in `game_detail` and `live_api._events_payload` add
  `AND visible = 1`.
- `python -m mtga_tracker.replay_dump <game_id>` prints the stream for
  debugging.

### Frontend

New module `ui/src/replay/`, pure logic separated from React and from WebGL:

| File | Responsibility |
| --- | --- |
| `types.ts` | Stream types mirroring `replay_stream.py`. |
| `reducer.ts` | `applyEvent(state, event)` producing `BoardState` (ordered zones per seat, stack, life, turn, attackers, blockers, taps, counters, attachments). Builds a keyframe at every `turn` event on load; seeking restores the nearest keyframe and replays forward, so scrubbing a 2,000-event game stays instant. |
| `layout.ts` | `BoardState` → placed cards: zone slot, position, rotation, tapped angle, face-up flag, highlight, inferred flag. Renderer-agnostic and unit-tested; the WebGL scene only draws what it returns. Opponent cards face the viewer by default, with a "mirror opponent" option. Fixed depth, width from the stage aspect; creatures in front, lands then other permanents behind them; piles in a left lane; the stack anchored at the right edge under the DOM preview. |
| `player.ts` | Playback clock: play/pause, speed 0.5–8×, step, turn jumps, go-to-turn. **Paced** mode (default): every event holds at least 600 ms, real gaps scaled 1:4 and capped at 2.5 s. **Real time** mode: actual gaps times speed. |
| `images.ts` | Texture URL resolution and a loading queue (max 6 in flight, about 8 per second, Scryfall's published limit is 10). Prefers `cards/arena/<arena_id>?format=image&version=normal`, falls back to `cards/named?exact=`; caches resolved URLs in localStorage. Tokens without an Arena id get a generated face (name, type, P/T). Cards visible in the first turn preload before playback starts. |
| `prefs.ts` | Felt color, your sleeves, opponent sleeves, camera preset, mirror, hindsight toggle. localStorage `mtga-replay-prefs`. |
| `materials.ts` | Procedural felt normal map, sleeve back textures per color, card frame for generated token faces. |
| `components/ReplayPage.tsx` | Fetch, loading and error states, layout (scene left, log right; a notice instead of the canvas under 900 px), keyboard shortcuts, deep link `?at=<seq>` and `?return=`, `React.lazy` boundary. |
| `components/ReplayScene.tsx` | The `@react-three/fiber` canvas: felt plane, soft directional light and ambient fill, one textured card mesh per object keyed by id, piles with counts, hand fans, stack raised above the table, attackers slide forward, damage and life pulses, camera presets (table, top-down, player's eye) with eased transitions. Raycast hover opens the existing `CardLink` preview as a DOM overlay. |
| `components/ReplayControls.tsx` | Scrub bar segmented by turn and colored by active seat, turn ticks, previous/next turn, step back/forward, play/pause, speed, go-to-turn, counters. Shortcuts: Space, ←/→ step, J/K turn, Home/End, `[`/`]` speed, G go to turn. |
| `components/ReplayLog.tsx` | Action list grouped by turn, auto-scrolls to the current event, click to seek. Reuses `TimelineList` row styling and card segments. |
| `components/TablePopover.tsx` | The "Replay Options" popover: felt and sleeve pickers, camera preset, pacing, mirror, hindsight. |
| `components/StackPreview.tsx` + `scene/arrows.ts` | Large stack cards at the stage's right edge (top first, enter/exit animations) and the SVG targeting arrows projected each rendered frame. |
| `components/ReplayListPage.tsx` | The `#/replay` landing list of recent games with filters and state badges. |

Routing follows the existing pattern: `parseReplayRoute` (bare `#/replay` lists, `#/replay/<id>` plays), `replayRouteHash`
in `routes.ts`, `replayNavItems` in `nav.ts`, flags and ternaries in
`App.tsx`, and the snapshot-polling effect skips the overview fetch on this
route as the Deck Finder route does.

### Navigation and entry points

Teal is reserved for replay affordances everywhere in the dashboard, so a
teal control always means "watch this game". New tokens `--replay` (dark:
`#2bb3a3`, light: `#0f8f82`) sit beside `--draw` in `styles.css`.

| Surface | Change |
| --- | --- |
| Sidebar tile | A `sidebar-replay` tile directly above the Deck Finder tile in `sidebar-bottom` (`AppShell.tsx:424`), built from the same markup and the same `.sidebar-deck-finder` rules with `--replay` in place of `--draw`: bordered box, icon plus label, and the collapsed mini box variant with just the icon. Icon: lucide `Play` (or `Clapperboard`). Links to `#/replay`. |
| `#/replay` landing | "Replay" page listing recent games newest first, paged, with the shared `FormatQuickFilters`, a deck filter, result and opponent columns, and a state badge (Recorded / Reconstructed / Unavailable). It reuses the All Games row component. Clicking a row opens `#/replay/<id>?return=%23%2Freplay`. |
| `#/replay/<id>` | The player. Its back link honours `?return=` so the user lands where they came from. |
| Game Detail | A teal "Watch replay" button at the top right of the summary header (`#game-summary`, `GameDetailPage.tsx:778`), the same color as the tile; disabled with a tooltip when unavailable. The timeline end banner repeats the link, and each timeline row's time deep-links to that moment. |
| Recent Games (overview), All Games, deck and opponent histories | A teal play icon button at the end of every row, keyboard accessible, with the state in its tooltip. Bo3 groups show it on each game row. |
| Live Scoreboard | Button beside the "Previous Game" chip (`LiveLogPage.tsx:170-182`), in the ended-game banner, and on each "Today's Games" row. |
| Console tracker | After `_persist_game_analytics` in `tracker_summary.py` (line 407; the game row exists only after it) print `Replay: http://127.0.0.1:<port>/#/replay/<game_id>`. The console-only tracker omits the line when no dashboard is configured. |
| Menu bar | "Replays" opens `#/replay`; "Watch last replay" opens the newest finished game. |
| Overlay | Later: `game_id` and `replay_url` in the `/api/overlay` payload, a Tauri opener command, and a "Watch replay" button in the FINAL state. Separate release; the overlay has no opener today. |

Expected use is occasional: a bad loss or a confusing turn, not every game.
The statistics pages stay the primary view; replay links are cheap row-level
affordances rather than new sections, and nothing is preloaded until a
replay is opened.

## Phases

### Phase 0 — Contract and fixtures

- `replay_stream.py` dataclasses and encoder; `ui/src/replay/types.ts`.
- `scripts/export_replay_fixture.py` dumps one game's rows to
  `tests/fixtures/replay/<name>.json`. Export three real games: a short aggro
  game, a long Brawl game with tokens and commanders, and one with a
  mulligan, a countered spell and `Card #N` rows.
- Route, nav entry, empty lazy-loaded `ReplayPage`.

### Phase 1 — Reconstructed replays for every existing game, and the page

- `replay_reconstruct.py`; `GET /api/replay`; availability on detail and
  list rows.
- Reducer, layout, player, images, prefs, materials, scene, controls, log,
  table popover with felt and sleeve colors.
- The sidebar tile, the `#/replay` landing list, and every entry point except the overlay.
- Acceptance: every game with events opens; library counts never go negative;
  the final battlefield matches cards played minus cards removed within a
  tolerance asserted over the fixtures; seeking a 1,500-event game stays
  under 16 ms; 60 fps on an integrated GPU with 40 cards on the table; no
  console errors.

### Phase 2 — Structured capture in the tracker

- Migration 31; `ReplayFact` on `_print_event`; `_record_silent_event`;
  `games.replay_version = 1` at game end.
- Mixin changes for the version-1 vocabulary: ids on every zone transfer
  including hidden cards, resolution and graveyard moves, batched untaps,
  counters, P/T, tokens, attachments, blocks, targets, stack ids, phase and
  step rows.
- `replay_builder.py`; `visible = 1` filters on the timeline and live feeds;
  the fidelity badge switches to "Recorded".
- Acceptance: a game imported from a saved `Player.log` with
  `scripts/import_game_from_log.py` replays with the correct board at every
  turn boundary when checked by hand against the log; the console output and
  Game Detail timeline are byte-identical to before for the same log; the
  per-message cost of the new handlers stays under 1 ms in the existing
  tracker benchmark style.

### Phase 3 — Polish

- Animation pass: card flight paths, flips on reveal, pulses, camera eases.
- Optional local image cache (`GET /api/card-image?arena_id=&name=`, disk
  cache under the data dir, Scryfall-compliant spacing and user agent) for
  offline replays and faster loads. Not required for export since Scryfall
  allows cross-origin textures.
- Light theme HUD pass, keyboard help overlay, overlay button.

### Phase 4 (version 2) — Video export

- `canvas.captureStream(30)` plus `MediaRecorder` renders the scene at a
  chosen speed to WebM (VP9), with the HUD (life, turn, action ticker)
  composited into a second canvas layer so the frames are self-contained.
  YouTube accepts WebM directly; Safari produces MP4/H.264 through the same
  API.
- Optional MP4 conversion as a dashboard job (like the collection export)
  when `ffmpeg` is on the PATH; otherwise WebM with a one-line hint.
- Title card (decks, format, date, result) and end card (final board, Tapps
  Tracker name).
- Out of scope: YouTube OAuth upload. "Send to YouTube" opens the upload page.

## Testing

- Python: `tests/test_replay_reconstruct.py` (one test per grammar shape plus
  whole-fixture tests on zone counts and final board),
  `tests/test_replay_capture.py` (minimal `GameStateMessage` payloads in the
  style of `tests/test_tracker_combat_winner.py` for every version-1 event
  kind, hidden-card ids, batched untaps, untracked and mid-game-attach skips,
  ghost purge, console text unchanged), `tests/test_replay_builder.py` (rows
  → stream, stack ids, hindsight hand), `tests/test_dashboard_replay_api.py`
  (400/404/200, cache invalidation, `visible` filtering).
- UI: `reducer.test.ts`, `layout.test.ts`, `player.test.ts`,
  `images.test.ts`, `prefs.test.ts`, `ReplayPage.test.tsx` with the WebGL
  canvas mocked, `routes.test.ts` additions.
- Visual: `ui/scripts/replay_shots.mjs` (Playwright, like
  `overlay/scripts/screenshots.mjs`) renders turn 1, a combat step and the
  final board of each fixture in every felt color for review.

## Invariants this plan must respect

- Capture runs on the tracker thread per message through the same insert
  path the console already uses: no deep copies, no extra parsing passes,
  nothing kept for untracked matches or mid-game attaches. Live tracking is
  never blocked or restarted.
- Console output and the existing timeline do not change for the user;
  silent rows are filtered everywhere they are read.
- Dashboard reads stay set-based and cached.
- Card names are never resolved over the network; images already come from
  Scryfall and stay the only network use.
- Migrations are numbered (next is 31); schema changes are additive.
- No Wizards of the Coast artwork or trade dress in the table, sleeves or
  generated token faces.
- Python 3.9 syntax, black at 100 columns, `tsc -b` and eslint clean, fresh
  `ui/dist` before packaging, changelog entry under the release being
  prepared.

## Files expected to change

New: `src/mtga_tracker/replay_stream.py`, `replay_reconstruct.py`,
`replay_builder.py`, `replay_dump.py`; `ui/src/replay/*`;
`scripts/export_replay_fixture.py`; `tests/test_replay_*.py`;
`tests/fixtures/replay/*`.

Modified: `analytics.py` (migration 31, silent-event writer),
`tracker_analytics.py` (`_record_game_event` structured fields),
`tracker_rendering.py` (`_print_event` signature), `tracker_events.py`
(ignored-annotation set shrinks), `tracker_zone_transfers.py`,
`tracker_stack.py`, `tracker_combat.py`, `tracker_event_turns.py`,
`tracker_state_lookup.py`, `tracker_summary.py` (console link),
`dashboard.py` (`/api/replay`, availability, `visible` filter),
`live_api.py`, `ui/package.json` (three, `@react-three/fiber`,
`@react-three/drei`), `ui/src/routes.ts`, `nav.ts`, `App.tsx`,
`AppShell.tsx`, `api.ts`, `GameDetailPage.tsx`, `LiveLogPage.tsx`, game list
rows, `styles.css`, `menu_app.py`, `AGENTS.md`, `CHANGELOG.md`,
`docs/plans/INDEX.md`.
