import { describe, expect, it } from 'vitest';
import { parseDeckFinderImport } from './deckFinderImport';

describe('Deck Finder import display', () => {
  it('counts only main-deck cards and preserves all import sections', () => {
    const result = parseDeckFinderImport(
      'About\r\nName Arena Brew (HGG)\r\n\r\nCommander\r\n1 Atraxa, Grand Unifier (ONE) 196\r\n\r\nDeck\r\n4 Opt (STA) 19\r\n56 Island\r\n\r\nSideboard\r\n2 Negate (MOM) 68\r\n\r\nCompanion\r\n1 Yorion, Sky Nomad\r\nMaybeboard\r\n2 Forest',
    );
    expect(result).toMatchObject({ name: 'Arena Brew (HGG)', mainCount: 60, mainNames: 2 });
    expect(result?.sections.map((section) => section.name)).toEqual([
      'Commander', 'Deck', 'Sideboard', 'Companion', 'Maybeboard',
    ]);
    expect(result?.sections[1].cards[0]).toEqual({ quantity: 4, name: 'Opt' });
  });

  it('keeps split-card names and counts repeated printings as one card name', () => {
    const result = parseDeckFinderImport('Decklist:\n2 Fire // Ice (MH2) 290\n10 Island (UST) 213\n48 Island (EOE) 265');
    expect(result).toMatchObject({ mainCount: 60, mainNames: 2 });
    expect(result?.sections[0].cards[0].name).toBe('Fire // Ice');
  });

  it('accepts card-only lists and refuses to hide unknown import content', () => {
    expect(parseDeckFinderImport('60 Forest')?.mainCount).toBe(60);
    expect(parseDeckFinderImport('Deck\n60 Forest\nUnrecognized section')).toBeNull();
    expect(parseDeckFinderImport('Deck\n0 Forest')).toBeNull();
    expect(parseDeckFinderImport(null)).toBeNull();
  });
});
