import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, FELT_COLORS, PREFS_STORAGE_KEY, SLEEVE_COLORS, loadPrefs, savePrefs, subscribePrefs } from './prefs';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('replay prefs', () => {
  it('defines the contract palettes with hex colors', () => {
    expect(Object.keys(FELT_COLORS)).toEqual(['green', 'blue', 'burgundy', 'charcoal', 'camel', 'purple']);
    expect(Object.keys(SLEEVE_COLORS)).toEqual(['navy', 'crimson', 'forest', 'charcoal', 'violet', 'gold']);
    for (const color of [...Object.values(FELT_COLORS), ...Object.values(SLEEVE_COLORS)]) {
      expect(color.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(color.accent).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('returns defaults when nothing is stored', () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS).toMatchObject({ felt: 'green', playerSleeve: 'navy', opponentSleeve: 'crimson' });
  });

  it('round-trips saved values and notifies subscribers', () => {
    const seen = vi.fn();
    const unsubscribe = subscribePrefs(seen);
    const saved = savePrefs({ felt: 'camel', speed: 4, mirrorOpponent: true });
    expect(saved).toMatchObject({ felt: 'camel', speed: 4, mirrorOpponent: true, playerSleeve: 'navy' });
    expect(loadPrefs()).toEqual(saved);
    expect(seen).toHaveBeenCalledWith(saved);
    unsubscribe();
    savePrefs({ felt: 'blue' });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('replaces unknown or malformed stored values with defaults', () => {
    localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({ felt: 'neon', playerSleeve: 'gold', speed: 3, hindsight: 'yes', camera: 'topdown' }),
    );
    expect(loadPrefs()).toEqual({ ...DEFAULT_PREFS, playerSleeve: 'gold', camera: 'topdown' });
    localStorage.setItem(PREFS_STORAGE_KEY, '{not json');
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('remembers the collapsed Actions panel and rejects non-boolean values', () => {
    expect(DEFAULT_PREFS.logCollapsed).toBe(false);
    expect(savePrefs({ logCollapsed: true }).logCollapsed).toBe(true);
    expect(JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) ?? '{}').logCollapsed).toBe(true);
    expect(loadPrefs().logCollapsed).toBe(true);
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ logCollapsed: 'yes' }));
    expect(loadPrefs().logCollapsed).toBe(false);
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    // Falls back to the last in-memory save (or defaults) instead of throwing.
    expect(() => loadPrefs()).not.toThrow();
    expect(savePrefs({ felt: 'purple' }).felt).toBe('purple');
    expect(loadPrefs().felt).toBe('purple');
  });

  it('reacts to changes from other tabs', () => {
    const seen = vi.fn();
    const unsubscribe = subscribePrefs(seen);
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ felt: 'charcoal' }));
    window.dispatchEvent(new StorageEvent('storage', { key: PREFS_STORAGE_KEY }));
    expect(seen.mock.calls[0][0].felt).toBe('charcoal');
    unsubscribe();
  });
});
