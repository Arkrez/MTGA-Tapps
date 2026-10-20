/**
 * Draft Replay model: turns a draft stream into framework timeline steps
 * (one per pick) and works out, for each pick, whether the pack came round
 * before (it "wheeled") and which cards left it since — the cards the other
 * drafters took, plus the player's own earlier pick. Pure; no React.
 */
import type { TimelineStep } from '../framework/timeline';
import type { DraftCard, DraftRarity, DraftStream } from './types';

export const RARITY_ORDER: Record<DraftRarity, number> = {
  mythic: 0,
  rare: 1,
  uncommon: 2,
  common: 3,
  basic: 4,
};

/** Pod sizes considered when working out how many picks a pack takes to come back. */
export const MIN_POD = 2;
export const MAX_POD = 12;

export interface MissingCard {
  arena_id: number;
  /** The player took this copy the last time they saw the pack. */
  takenByYou: boolean;
}

export interface DraftStep extends TimelineStep {
  pack: number;
  pick: number;
  packCards: number[];
  picked: number[];
  /** Index of the step where this same pack was last seen, or null when it is new to the player. */
  seenAt: number | null;
  /** Pick number of that earlier sighting. */
  seenPick: number | null;
  /** Cards gone since the earlier sighting, rarest first (empty when `seenAt` is null). */
  missing: MissingCard[];
  /** Every card picked before this step, in pick order. */
  poolBefore: number[];
}

export function stepKey(pack: number, pick: number): string {
  return `p${pack}p${pick}`;
}

function counts(cards: readonly number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const card of cards) out.set(card, (out.get(card) ?? 0) + 1);
  return out;
}

/** Whether every card of `small` is in `big`, copies included. */
export function containsAll(big: readonly number[], small: readonly number[]): boolean {
  const have = counts(big);
  for (const [card, n] of counts(small)) {
    if ((have.get(card) ?? 0) < n) return false;
  }
  return true;
}

/** `big` minus `small`, copies included, in `big`'s order. */
export function removeAll(big: readonly number[], small: readonly number[]): number[] {
  const left = counts(small);
  const out: number[] = [];
  for (const card of big) {
    const n = left.get(card) ?? 0;
    if (n > 0) left.set(card, n - 1);
    else out.push(card);
  }
  return out;
}

export function cardFor(stream: DraftStream, arenaId: number): DraftCard {
  return (
    stream.cards[String(arenaId)] ?? {
      arena_id: arenaId,
      name: `Card #${arenaId}`,
      rarity: 'common',
    }
  );
}

/** Rarest first, then by name — the order the missing strip uses. */
export function compareByRarity(a: DraftCard, b: DraftCard): number {
  return RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] || a.name.localeCompare(b.name);
}

function missingSince(stream: DraftStream, earlier: number[], now: number[], yourPick: number[]): MissingCard[] {
  const gone = removeAll(earlier, now);
  const yours = counts(yourPick);
  return gone
    .map((arenaId) => {
      const n = yours.get(arenaId) ?? 0;
      if (n > 0) yours.set(arenaId, n - 1);
      return { arena_id: arenaId, takenByYou: n > 0 };
    })
    .sort((a, b) => {
      const byRarity = compareByRarity(cardFor(stream, a.arena_id), cardFor(stream, b.arena_id));
      return byRarity || Number(b.takenByYou) - Number(a.takenByYou);
    });
}

type PickRow = DraftStream['picks'][number];

function wheels(earlier: PickRow | DraftStep, now: PickRow): boolean {
  const before = 'packCards' in earlier ? earlier.packCards : earlier.pack_cards;
  return before.length > now.pack_cards.length && containsAll(before, now.pack_cards);
}

/**
 * Picks it takes a pack to come back round (the pod size, 8 for Arena's
 * drafts). Inferred from the draft itself — the gap at which packs of two or
 * more cards most often turn out to be an earlier pack minus a few cards — so
 * a late one-card pack is only matched at that gap, never by coincidence.
 * Null when no pack wheeled.
 */
export function inferPodSize(rows: readonly PickRow[]): number | null {
  const at = new Map(rows.map((row) => [stepKey(row.pack, row.pick), row]));
  let best: number | null = null;
  let bestScore = 0;
  for (let gap = MIN_POD; gap <= MAX_POD; gap += 1) {
    let score = 0;
    for (const row of rows) {
      const earlier = at.get(stepKey(row.pack, row.pick - gap));
      if (row.pack_cards.length >= 2 && earlier && wheels(earlier, row)) score += 1;
    }
    if (score > bestScore) {
      best = gap;
      bestScore = score;
    }
  }
  return best;
}

export function buildDraftSteps(stream: DraftStream): DraftStep[] {
  const rows = [...stream.picks].sort((a, b) => a.pack - b.pack || a.pick - b.pick);
  const pod = inferPodSize(rows);
  const steps: DraftStep[] = [];
  const indexOf = new Map<string, number>();
  const pool: number[] = [];
  rows.forEach((row) => {
    let seenAt: number | null = null;
    if (pod && row.pack_cards.length) {
      // The nearest earlier sighting: one lap back, else two (a missed lap in between).
      for (let back = row.pick - pod; back >= 1 && seenAt === null; back -= pod) {
        const j = indexOf.get(stepKey(row.pack, back));
        if (j !== undefined && wheels(steps[j], row)) seenAt = j;
      }
    }
    const earlier = seenAt === null ? null : steps[seenAt];
    indexOf.set(stepKey(row.pack, row.pick), steps.length);
    steps.push({
      key: stepKey(row.pack, row.pick),
      label: `Pack ${row.pack} · Pick ${row.pick}`,
      group: `Pack ${row.pack}`,
      pack: row.pack,
      pick: row.pick,
      packCards: row.pack_cards,
      picked: row.picked,
      seenAt,
      seenPick: earlier ? earlier.pick : null,
      missing: earlier ? missingSince(stream, earlier.packCards, row.pack_cards, earlier.picked) : [],
      poolBefore: [...pool],
    });
    pool.push(...row.picked);
  });
  return steps;
}

export const POOL_COLUMNS = ['0–1', '2', '3', '4', '5', '6+', 'Lands'] as const;
export type PoolColumn = (typeof POOL_COLUMNS)[number];

/** MTGA's draft pool layout: one column per mana value, lands on their own. */
export function poolColumn(card: DraftCard): PoolColumn {
  if (card.types?.includes('Land') && !card.types.includes('Creature')) return 'Lands';
  const value = card.mana_value ?? 0;
  if (value <= 1) return '0–1';
  if (value >= 6) return '6+';
  return String(value) as PoolColumn;
}

export interface PoolSummary {
  total: number;
  creatures: number;
  noncreatures: number;
  lands: number;
  /** Colored cards per color, WUBRG order (a gold card counts for each of its colors). */
  colors: Array<{ color: string; count: number }>;
}

export function summarizePool(stream: DraftStream, pool: readonly number[]): PoolSummary {
  let creatures = 0;
  let lands = 0;
  const byColor = new Map<string, number>();
  for (const arenaId of pool) {
    const card = cardFor(stream, arenaId);
    if (card.types?.includes('Creature')) creatures += 1;
    else if (card.types?.includes('Land')) lands += 1;
    for (const color of card.colors ?? '') byColor.set(color, (byColor.get(color) ?? 0) + 1);
  }
  return {
    total: pool.length,
    creatures,
    lands,
    noncreatures: pool.length - creatures - lands,
    colors: [...'WUBRG'].filter((c) => byColor.has(c)).map((color) => ({ color, count: byColor.get(color) ?? 0 })),
  };
}

/** The packs in Arena's draft view: rarest first, Arena's own order kept within a rarity. */
export function byRarity(stream: DraftStream, cards: readonly number[]): number[] {
  return cards
    .map((arenaId, index) => ({ arenaId, index }))
    .sort((a, b) => RARITY_ORDER[cardFor(stream, a.arenaId).rarity] - RARITY_ORDER[cardFor(stream, b.arenaId).rarity] || a.index - b.index)
    .map((entry) => entry.arenaId);
}

/** Copies of each card in the submitted main deck (empty when no deck was seen). */
export function mainDeckCounts(stream: DraftStream): Map<number, number> {
  const out = new Map<number, number>();
  for (const card of stream.deck?.main ?? []) out.set(card.arena_id, (out.get(card.arena_id) ?? 0) + card.quantity);
  return out;
}

/**
 * Which copies in `cards` made the final deck: the first N copies of a card
 * the deck plays N of. Index-aligned with `cards`.
 */
export function inDeckFlags(cards: readonly number[], deck: ReadonlyMap<number, number>): boolean[] {
  const left = new Map(deck);
  return cards.map((arenaId) => {
    const n = left.get(arenaId) ?? 0;
    if (n > 0) left.set(arenaId, n - 1);
    return n > 0;
  });
}
