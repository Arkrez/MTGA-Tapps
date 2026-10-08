import { describe, expect, it } from 'vitest';
import { PLAYER, makeSampleStream } from './fixtures/sampleStream';
import { activeItemIndex, buildLogItems, eventActor, formatClock, logParts, phaseLabel, stripClock } from './logText';
import type { ReplayEvent } from './types';

describe('action log text', () => {
  it('strips the console clock and formats elapsed time', () => {
    expect(stripClock('[0:39] You: played')).toBe('You: played');
    expect(stripClock('[1:02:03] Opponent: drew')).toBe('Opponent: drew');
    expect(formatClock(161)).toBe('2:41');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });

  it('removes card brackets and keeps the type suffix as metadata', () => {
    const parts = logParts([
      { kind: 'text', text: '[0:39] You: cast [' },
      { kind: 'card', text: 'Shimmerwilds Growth', card_name: 'Shimmerwilds Growth', card_type: 'Enchantment' },
      { kind: 'text', text: ' (Enchantment)] -> [' },
      { kind: 'card', text: 'Hushwood Verge', card_name: 'Hushwood Verge' },
      { kind: 'text', text: ']' },
    ]);
    expect(parts).toEqual([
      { kind: 'text', text: 'You: cast ' },
      { kind: 'card', name: 'Shimmerwilds Growth', text: 'Shimmerwilds Growth', meta: 'Enchantment' },
      { kind: 'text', text: ' -> ' },
      { kind: 'card', name: 'Hushwood Verge', text: 'Hushwood Verge', meta: null },
    ]);
  });

  it('assigns actors from the text prefix, then the acting seat', () => {
    const base = { seq: 1, t: 0, turn: 1, phase: null, step: null };
    const you: ReplayEvent = { ...base, kind: 'note', log: { text: '[0:01] You: chose', segments: [] } };
    const life: ReplayEvent = { ...base, kind: 'life', seat: 1, life: 19, delta: -1, source_obj: null, log: { text: 'lost 1', segments: [] } };
    expect(eventActor(you, 2)).toBe('player');
    expect(eventActor(life, 2)).toBe('opponent');
    expect(eventActor({ ...base, kind: 'note', log: null }, 2)).toBe('system');
  });

  it('groups logged events under turn headers and finds the active row', () => {
    const stream = makeSampleStream();
    const items = buildLogItems(stream);
    expect(items[0]).toMatchObject({ type: 'turn', turn: 1 });
    expect(items.filter((i) => i.type === 'turn')).toHaveLength(stream.turns.length);
    const firstRow = items.find((i) => i.type === 'event')!;
    expect(activeItemIndex(items, firstRow.seq)).toBe(items.indexOf(firstRow));
    expect(activeItemIndex(items, -5)).toBe(-1);
    expect(eventActor(stream.events.find((e) => e.kind === 'life' && e.seat === PLAYER)!, PLAYER)).toBe('player');
  });

  it('labels phases and steps', () => {
    expect(phaseLabel('Phase_Combat')).toBe('Combat');
    expect(phaseLabel('Step_DeclareAttack')).toBe('Declare attack');
    expect(phaseLabel('Phase_Main1')).toBe('Main 1');
    expect(phaseLabel(null)).toBeNull();
  });
});
