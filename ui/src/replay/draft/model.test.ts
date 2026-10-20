import { describe, expect, it } from 'vitest';
import { buildDraftSteps, containsAll, inferPodSize, poolColumn, removeAll, summarizePool } from './model';
import type { DraftCard, DraftStream } from './types';

function card(arena_id: number, rarity: DraftCard['rarity'] = 'common', extra: Partial<DraftCard> = {}): DraftCard {
  return { arena_id, name: `Card ${arena_id}`, rarity, colors: 'W', types: ['Creature'], mana_value: 2, ...extra };
}

/**
 * A four-drafter pod with six-card packs: the pack from pick 1 comes back at
 * pick 5, the one from pick 2 at pick 6. Pick 4's pack happens to hold card
 * 12 too, so pick 6's single card is also "inside" pick 4's pack — a
 * coincidence the pod-size rule must not fall for.
 */
function stream(): DraftStream {
  const cards = [
    card(1, 'rare'),
    card(3, 'rare'),
    card(4, 'mythic'),
    card(5, 'uncommon'),
    card(11, 'uncommon'),
  ];
  return {
    version: 1,
    draft: { id: 'd', kind: 'player', event_name: null, format_label: 'Draft', started_at: null, updated_at: null, completed_at: null },
    pool: [],
    cards: Object.fromEntries(cards.map((c) => [String(c.arena_id), c])),
    picks: [
      { pack: 1, pick: 1, pack_cards: [1, 2, 3, 4, 5, 6], picked: [1], observed_at: null },
      { pack: 1, pick: 2, pack_cards: [11, 12, 13, 14, 15], picked: [11], observed_at: null },
      { pack: 1, pick: 3, pack_cards: [21, 22, 23, 24], picked: [21], observed_at: null },
      { pack: 1, pick: 4, pack_cards: [31, 12, 33], picked: [31], observed_at: null },
      { pack: 1, pick: 5, pack_cards: [6, 2], picked: [6], observed_at: null },
      { pack: 1, pick: 6, pack_cards: [12], picked: [12], observed_at: null },
      { pack: 2, pick: 1, pack_cards: [], picked: [41], observed_at: null },
    ],
  };
}

describe('draft model', () => {
  it('compares packs as multisets', () => {
    expect(containsAll([1, 2, 2, 3], [2, 2])).toBe(true);
    expect(containsAll([1, 2, 3], [2, 2])).toBe(false);
    expect(removeAll([1, 2, 2, 3, 2], [2, 3])).toEqual([1, 2, 2]);
  });

  it('infers how many picks a pack takes to come back', () => {
    expect(inferPodSize(stream().picks)).toBe(4);
    expect(inferPodSize(stream().picks.slice(0, 4))).toBeNull();
  });

  it('marks a pack that wheeled and lists what left it, rarest first', () => {
    const steps = buildDraftSteps(stream());
    expect(steps.map((s) => s.key)).toEqual(['p1p1', 'p1p2', 'p1p3', 'p1p4', 'p1p5', 'p1p6', 'p2p1']);
    expect(steps.slice(0, 4).map((s) => s.seenAt)).toEqual([null, null, null, null]);
    const wheel = steps[4];
    expect(wheel.seenAt).toBe(0);
    expect(wheel.seenPick).toBe(1);
    // Pack at pick 1 minus pack at pick 5: your pick 1, then 3, 4 and 5 taken by others.
    expect(wheel.missing).toEqual([
      { arena_id: 4, takenByYou: false },
      { arena_id: 1, takenByYou: true },
      { arena_id: 3, takenByYou: false },
      { arena_id: 5, takenByYou: false },
    ]);
  });

  it('matches a one-card pack one lap back, not to a recent pack that happens to contain it', () => {
    const last = buildDraftSteps(stream())[5];
    expect(last.seenPick).toBe(2);
    expect(last.missing.map((m) => m.arena_id)).toEqual([11, 13, 14, 15]);
    expect(last.missing[0].takenByYou).toBe(true);
  });

  it('never matches across packs or a pack the tracker did not see', () => {
    const steps = buildDraftSteps(stream());
    expect(steps[6].seenAt).toBeNull();
    expect(steps[6].missing).toEqual([]);
    expect(steps[6].group).toBe('Pack 2');
  });

  it('builds the pool before each pick in pick order', () => {
    const steps = buildDraftSteps(stream());
    expect(steps[0].poolBefore).toEqual([]);
    expect(steps[3].poolBefore).toEqual([1, 11, 21]);
    expect(steps[6].poolBefore).toEqual([1, 11, 21, 31, 6, 12]);
  });

  it('lays the pool out in mana-value columns and summarizes it', () => {
    const s = stream();
    s.cards = {
      '1': card(1),
      '3': card(3, 'rare', { colors: 'B', types: ['Instant'], mana_value: 1 }),
      '6': card(6, 'rare', { colors: 'B' }),
      '7': card(7, 'common', { colors: '', types: ['Land'], mana_value: 0 }),
    };
    expect(poolColumn(s.cards['3'])).toBe('0–1');
    expect(poolColumn(s.cards['1'])).toBe('2');
    expect(poolColumn(s.cards['7'])).toBe('Lands');
    expect(poolColumn(card(9, 'rare', { mana_value: 7 }))).toBe('6+');
    expect(summarizePool(s, [1, 3, 6, 7])).toEqual({
      total: 4,
      creatures: 2,
      noncreatures: 1,
      lands: 1,
      colors: [
        { color: 'W', count: 1 },
        { color: 'B', count: 2 },
      ],
    });
  });
});
