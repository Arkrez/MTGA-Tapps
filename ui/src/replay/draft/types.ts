/** Draft Replay stream and list types (docs/DRAFT_REPLAY.md §2). */

export type DraftRarity = 'mythic' | 'rare' | 'uncommon' | 'common' | 'basic';

export interface DraftCard {
  arena_id: number;
  name: string;
  rarity: DraftRarity;
  /** Scryfall braces (`{1}{W}`); null when Arena's DB has no cost text. */
  mana_cost?: string | null;
  mana_value?: number | null;
  /** WUBRG letters, empty for colorless. */
  colors?: string;
  types?: string[];
  set_code?: string | null;
}

export interface DraftPickRow {
  /** 1-based. */
  pack: number;
  /** 1-based. */
  pick: number;
  /** The pack in front of the player, in Arena's order; empty when the tracker missed it. */
  pack_cards: number[];
  /** The card(s) taken (two in Pick Two drafts); empty when the tracker missed the pick. */
  picked: number[];
  observed_at: string | null;
}

export interface DraftInfo {
  id: string;
  kind: 'bot' | 'player';
  event_name: string | null;
  format_label: string;
  course_id?: string | null;
  started_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
}

export interface DraftDeckCard {
  arena_id: number;
  quantity: number;
}

export interface DraftDeck {
  name: string | null;
  submitted_at: string | null;
  main: DraftDeckCard[];
  sideboard: DraftDeckCard[];
}

export interface DraftStream {
  version: 1;
  draft: DraftInfo;
  picks: DraftPickRow[];
  /** Arena's final card pool (empty until the draft completes). */
  pool: number[];
  /** The deck last submitted to the draft's event; null when none was seen. */
  deck?: DraftDeck | null;
  /** Card facts keyed by grpId. */
  cards: Record<string, DraftCard>;
}

export interface DraftListRow {
  id: string;
  kind: 'bot' | 'player';
  event_name: string | null;
  format_label: string;
  started_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
  picks: number;
  packs: number;
  /** The pool's two most-picked colors (WUBRG). */
  colors: string;
  /** Games played with the draft's deck: its event, from the draft until the next draft of that event. */
  record?: { wins: number; losses: number; games: number };
  first_pick: { arena_id: number; name: string | null } | null;
}
