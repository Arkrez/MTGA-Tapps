import { describe, expect, it } from 'vitest';
import { PICTURES_MAX, UNDER_MAX_ROWS, previewPosition, underListHeight, underPictures } from './hoverStore';
import type { HoverInfo, HoverUnder } from './hoverStore';

const base: HoverInfo = { key: 'scene:1', card: 'a1', name: 'Bear', x: 400, y: 500, source: 'scene' };
const viewport = { width: 1400, height: 800 };
const sword = (): HoverUnder => ({ card: 'eq', name: 'Sword', zone: 'battlefield' });
const island = (): HoverUnder => ({ card: 'isl', name: 'Island', zone: 'exile' });

describe('underPictures', () => {
  it('lists each distinct known card once, top of the stack first, with its copy count', () => {
    expect(underPictures([sword(), sword(), island(), { card: null, name: '', zone: 'exile' }])).toEqual([
      { card: 'isl', name: 'Island', count: 1 },
      { card: 'eq', name: 'Sword', count: 2 },
    ]);
    expect(underPictures([])).toEqual([]);
  });
});

describe('previewPosition', () => {
  it('keeps a plain card at the host width with no picture column', () => {
    const plain = previewPosition(base, viewport);
    expect(plain.width).toBe(plain.hostWidth);
    expect(plain.pictureColumns).toBe(0);
    expect(underListHeight(0)).toBe(0);
  });

  it('adds full-size pictures for one or two distinct cards and a 2×2 grid beyond that', () => {
    const one = previewPosition({ ...base, under: [sword(), sword()] }, viewport);
    expect(one.pictureColumns).toBe(1);
    expect(one.pictureWidth).toBe(one.hostWidth - 10);
    expect(one.width).toBe(one.hostWidth + 8 + one.pictureWidth);

    const two = previewPosition({ ...base, under: [sword(), island()] }, viewport);
    expect(two.pictureColumns).toBe(2);
    expect(two.width).toBe(two.hostWidth + 8 + 2 * two.pictureWidth + 8);

    const many = Array.from({ length: PICTURES_MAX + 1 }, (_, i): HoverUnder => ({ card: `c${i}`, name: `Card ${i}`, zone: 'battlefield' }));
    const grid = previewPosition({ ...base, under: many }, viewport);
    expect(grid.pictureColumns).toBe(2);
    expect(grid.pictureWidth).toBeLessThan(two.pictureWidth);
    expect(grid.width).toBeLessThan(two.width);
  });

  it('grows the box for the tucked-card list and keeps it inside the viewport', () => {
    const plain = previewPosition(base, viewport);
    const under = Array.from({ length: UNDER_MAX_ROWS + 2 }, (_, i): HoverUnder => ({ card: null, name: `Card ${i}`, zone: 'battlefield' }));
    const withList = previewPosition({ ...base, under }, viewport);
    expect(withList.width).toBe(plain.width);
    expect(underListHeight(under.length)).toBeGreaterThan(underListHeight(UNDER_MAX_ROWS));
    // A taller box is pushed up so its bottom edge stays on screen.
    expect(withList.top).toBeLessThan(plain.top);
    expect(withList.top).toBeGreaterThanOrEqual(12);
    // A wide box near the right edge flips to the left of the pointer and stays on screen.
    const wide = previewPosition({ ...base, x: 1300, under: [sword(), island()] }, viewport);
    expect(wide.left + wide.width).toBeLessThanOrEqual(1400 - 12);
    expect(wide.left).toBeLessThan(1300);
  });
});
