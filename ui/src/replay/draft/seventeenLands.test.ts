import { describe, expect, it } from 'vitest';
import { formatWinRate, heatColor, ratingStats, seventeenLandsExpansions, seventeenLandsFormat } from './seventeenLands';
import type { DraftCard, DraftStream } from './types';

function stream(eventName: string | null, kind: 'bot' | 'player', sets: string[]): Pick<DraftStream, 'cards' | 'draft'> {
  const cards: Record<string, DraftCard> = {};
  sets.forEach((set, n) => {
    cards[String(n)] = { arena_id: n, name: `C${n}`, rarity: 'common', set_code: set };
  });
  return {
    cards,
    draft: { id: 'd', kind, event_name: eventName, format_label: '', started_at: null, updated_at: null, completed_at: null },
  };
}

describe('17lands mapping', () => {
  it('maps Arena events to 17lands formats', () => {
    expect(seventeenLandsFormat({ event_name: 'PremierDraft_FRA_20260929', kind: 'player' })).toBe('PremierDraft');
    expect(seventeenLandsFormat({ event_name: 'TradDraft_FRA_20260929', kind: 'player' })).toBe('TradDraft');
    expect(seventeenLandsFormat({ event_name: 'PickTwoDraft_FRA_20260929', kind: 'player' })).toBe('PickTwoDraft');
    expect(seventeenLandsFormat({ event_name: 'Y26_FRA_Bot_Draft_20261017', kind: 'bot' })).toBe('QuickDraft');
    expect(seventeenLandsFormat({ event_name: 'ArenaLimitedQualifier_Draft1_20261016', kind: 'player' })).toBe('PremierDraft');
    expect(seventeenLandsFormat({ event_name: null, kind: 'player' })).toBe('PremierDraft');
  });

  it("reads the draft's main set and its Alchemy companion", () => {
    expect(seventeenLandsExpansions(stream('PremierDraft_FRA_20260929', 'player', ['FRA', 'FRA', 'SPG']))).toEqual(['FRA']);
    expect(seventeenLandsExpansions(stream('Y26_FRA_Bot_Draft_20261017', 'bot', ['FRA', 'Y26', 'FRA']))).toEqual(['FRA', 'Y26FRA']);
    expect(seventeenLandsExpansions(stream('QuickDraft_FRA', 'bot', ['FRA', 'Y26']))).toEqual(['FRA', 'Y26FRA']);
    expect(seventeenLandsExpansions(stream(null, 'player', []))).toEqual([]);
  });

  it('colors win rates relative to the set: red below, amber at, green above the mean', () => {
    const { mean, spread } = ratingStats(new Map([0.5, 0.55, 0.6, null].map((w, n) => [n, { gihWr: w, games: 100 }])));
    expect(mean).toBeCloseTo(0.55);
    expect(heatColor(mean, mean, spread)).toBe('hsl(45 85% 52%)');
    expect(heatColor(0.4, mean, spread)).toBe('hsl(0 85% 52%)');
    expect(heatColor(0.7, mean, spread)).toBe('hsl(130 85% 52%)');
    expect(formatWinRate(0.5823)).toBe('58.2%');
    expect(ratingStats(new Map())).toEqual({ mean: 0.55, spread: 0.03 });
  });
});
