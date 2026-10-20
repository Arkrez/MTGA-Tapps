# Draft Replay contract

Draft Replay steps through a draft pick by pick: the pack in front of the
player, the pick, whether the pack was seen before (it "wheeled"), which cards
left it since, and the pool as it is assembled. This file is the contract
between its three parts, like [REPLAY_FORMAT.md](REPLAY_FORMAT.md) is for game
replays. Change it first when a field changes.

1. **Capture** (`src/mtga_tracker/draft_capture.py`): reads draft entries from
   Arena's log into `drafts` / `draft_picks`.
2. **Serving** (`src/mtga_tracker/draft_api.py`): `/api/drafts`, `/api/draft`
   and the log rescan.
3. **Playback** (`ui/src/replay/draft/` on the shared `ui/src/replay/framework/`).

## 1. Capture

### Log shapes

| Draft type | Pack in front of the player | Pick | Event / completion |
| --- | --- | --- | --- |
| Bot (Quick Draft) | `<== BotDraftDraftStatus` and `<== BotDraftDraftPick` responses: `Payload` (a JSON string) with 0-based `PackNumber` / `PickNumber`, `DraftPack` (grpIds as strings), `PickedCards` (everything so far) and `DraftStatus` (`PickNext` / `Completed`) | `==> BotDraftDraftPick` request: `PickInfo.CardIds`, 0-based `PackNumber` / `PickNumber` | Course from `EventJoin` / `EventGetCoursesV2` (`CurrentModule: BotDraft`); `DraftCompleteDraft` response has the `CardPool` |
| Player (Premier, Traditional, Pick Two, qualifiers) | `Draft.Notify`: `draftId`, 1-based `SelfPack` / `SelfPick`, comma-joined `PackCards`. Arena pushes each pack up to three times | `==> EventPlayerDraftMakePick` request: `DraftId`, `GrpIds` (two cards in Pick Two), 1-based `Pack` / `Pick` | Course with `CurrentModule: PlayerDraft` names the event until `DraftCompleteDraft` (`DraftId`, `InternalEventName`, `CourseId`, `CardPool`) confirms it |

Arena never names a bot draft, so its id is `bot-<CourseId>` when the course
was seen, else a UUID5 of the event and the first time the tracker saw it. A
bot status with nothing picked after a draft that has picks starts a new row.

### Tables (migration 36)

```
drafts(id TEXT PK, kind 'bot'|'player', event_name, course_id,
       started_at, updated_at, completed_at, card_pool_json)
draft_picks(draft_id, pack_number, pick_number,      -- both 1-based
            pack_cards_json, picked_json, observed_at,
            PRIMARY KEY (draft_id, pack_number, pick_number))
```

Every write is an upsert on that key, so the live tracker and any number of
rescans of the same log agree. `pack_cards_json` is NULL when the tracker only
saw the pick, `picked_json` when it only saw the pack. Times are UTC ISO.

The live loop (`tracker_lifecycle._process_new_events`) passes entries
containing `Draft`, `EventJoin` or `EventGetCourses` to one long-lived
`DraftCapture`; a failure logs one diagnostics line and never stops tracking.
Gameplay reset clears both tables; backup merge unions them by draft id.

## 2. Serving

- `GET /api/drafts` → `{"drafts": [{id, kind, event_name, format_label,
  started_at, updated_at, completed_at, picks, packs, colors, first_pick:
  {arena_id, name}}]}`, newest first. `colors` is the pool's two most-picked
  colors in WUBRG order.
- `GET /api/draft?id=` → the stream below; 400 without `id`, 404 for an
  unknown draft.
- `POST /api/drafts/import-log` → rescans `Player-prev.log` then `Player.log`
  (the path the tracker is using, else the discovered one) and answers
  `{"drafts": <drafts touched>, "logs": [names read]}`. Local origins only.

```
{
  "version": 1,
  "draft": {"id", "kind", "event_name", "format_label", "course_id",
            "started_at", "updated_at", "completed_at"},
  "picks": [{"pack": 1, "pick": 1, "pack_cards": [grpId…],
             "picked": [grpId…], "observed_at": "ISO|null"}],
  "pool": [grpId…],                     // Arena's final pool; [] until complete
  "cards": {"<grpId>": {"arena_id", "name", "rarity", "mana_cost",
                        "mana_value", "colors", "types", "set_code"}}
}
```

Card facts come from Arena's local card DB (`CardDatabase.draft_card_facts`):
`rarity` is `basic` / `common` / `uncommon` / `rare` / `mythic` from
`Cards.Rarity` 1–5. A card the DB lacks still gets `{arena_id, name: "Card
#<id>", rarity: "common"}`.

## 3. Playback

### Framework (`ui/src/replay/framework/`)

Shared by any replay made of discrete steps:

- `timeline.ts` — `TimelineStep {key, label, group}`; groups become scrub
  segments and J/K jumps.
- `useStepPlayback.ts` — index, play/pause (stops on the last step), speed,
  and the shortcuts: Space, ←/→, J/K, Home/End, `[` `]`.
- `StepControls.tsx` — the transport bar, styled with the game replay's
  `replay-controls.css`.
- `kinds.ts` — the registry of replay kinds. Each owns a segment under
  `#/replay/` (games keep the bare `#/replay/<id>`) and a list section.

To add a kind: register it in `kinds.ts`, serve a stream, map it to steps,
and render a lazy-loaded page that uses `useStepPlayback` and `StepControls`.

### Draft model (`ui/src/replay/draft/model.ts`)

- One step per pick row, key `p<pack>p<pick>` (the `?step=` deep link).
- **Seen before:** the pod size is the pick gap at which packs of two or more
  cards most often equal an earlier pack minus some cards (8 in Arena's
  drafts, 4 in Pick Two). A pack is seen before when the pack one lap back (or
  two, if a lap is missing) contains every card of it. Matching only at the
  pod gap keeps a late one-card pack from matching a recent pack that happens
  to hold the same common.
- **Missing:** earlier pack minus current pack (copies counted), rarest first
  then by name; the copies the player took at the earlier sighting carry
  `takenByYou`.
- **Pool:** every pick before the step, plus the step's own pick unless picks
  are hidden. Laid out in Arena's mana-value columns (0–1, 2, 3, 4, 5, 6+,
  Lands).

### Viewer

`#/replay/draft/<id>?step=&return=` (lazy route). The pack grid highlights the
pick, a banner reports first look / seen before, the missing strip sits under
the pack, and the pool panel stacks cards like Arena's. **Hide picks** (H)
holds each pick back until **Reveal** (R). Images use the replay's
rate-limited Scryfall queue; cards Scryfall lacks get a drawn frame with name,
cost, type and rarity.
