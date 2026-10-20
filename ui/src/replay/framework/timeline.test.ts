import { describe, expect, it } from 'vitest';
import { clampIndex, indexOfKey, nextGroupStart, prevGroupStart, stepHoldMs, timelineGroups } from './timeline';

const steps = ['A', 'A', 'A', 'B', 'B', 'C'].map((group, n) => ({ key: `s${n}`, label: `Step ${n}`, group }));

describe('step timeline', () => {
  it('clamps indexes into range', () => {
    expect(clampIndex(-3, 5)).toBe(0);
    expect(clampIndex(9, 5)).toBe(4);
    expect(clampIndex(2.4, 5)).toBe(2);
    expect(clampIndex(Number.NaN, 5)).toBe(0);
    expect(clampIndex(3, 0)).toBe(0);
  });

  it('groups consecutive steps', () => {
    expect(timelineGroups(steps)).toEqual([
      { group: 'A', start: 0, end: 2 },
      { group: 'B', start: 3, end: 4 },
      { group: 'C', start: 5, end: 5 },
    ]);
    expect(timelineGroups([])).toEqual([]);
  });

  it('jumps between groups like a music player', () => {
    expect(nextGroupStart(steps, 0)).toBe(3);
    expect(nextGroupStart(steps, 4)).toBe(5);
    expect(nextGroupStart(steps, 5)).toBe(5);
    expect(prevGroupStart(steps, 4)).toBe(3);
    expect(prevGroupStart(steps, 3)).toBe(0);
    expect(prevGroupStart(steps, 1)).toBe(0);
    expect(prevGroupStart(steps, 0)).toBe(0);
  });

  it('finds steps by key and scales the hold by speed', () => {
    expect(indexOfKey(steps, 's4')).toBe(4);
    expect(indexOfKey(steps, 'nope')).toBeNull();
    expect(indexOfKey(steps, null)).toBeNull();
    expect(stepHoldMs(1800, 2)).toBe(900);
    expect(stepHoldMs(200, 4)).toBe(150);
  });
});
