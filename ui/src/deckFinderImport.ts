export interface ImportCard {
  quantity: number;
  name: string;
}

export interface ImportSection {
  name: string;
  cards: ImportCard[];
}

export interface ParsedDeckImport {
  name: string | null;
  sections: ImportSection[];
  mainCount: number;
  mainNames: number;
}

const HEADINGS: Record<string, string> = {
  deck: 'Deck', decklist: 'Deck', sideboard: 'Sideboard',
  companion: 'Companion', commander: 'Commander', maybeboard: 'Maybeboard',
};

/** Display-only parsing. Clipboard export always uses the original import text. */
export function parseDeckFinderImport(text: string | null | undefined): ParsedDeckImport | null {
  if (!text) return null;
  let name: string | null = null;
  const sections: ImportSection[] = [];
  let section: ImportSection | null = null;
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.toLowerCase() === 'about') continue;
    if (/^name\s+/iu.test(trimmed)) {
      name = trimmed.replace(/^name\s+/iu, '');
      continue;
    }
    const heading = HEADINGS[trimmed.toLowerCase().replace(/:$/u, '')];
    if (heading) {
      section = { name: heading, cards: [] };
      sections.push(section);
      continue;
    }
    const match = trimmed.match(/^(\d+)\s+(.+)$/u);
    if (!match || Number(match[1]) < 1) return null;
    if (!section) {
      section = { name: 'Deck', cards: [] };
      sections.push(section);
    }
    section.cards.push({
      quantity: Number(match[1]),
      name: match[2].replace(/\s+\([a-z0-9]+\)\s+\d+[a-z]?$/iu, ''),
    });
  }
  const filled = sections.filter((entry) => entry.cards.length > 0);
  if (!filled.length) return null;
  const main = filled.filter((entry) => entry.name === 'Deck').flatMap((entry) => entry.cards);
  return {
    name, sections: filled,
    mainCount: main.reduce((sum, card) => sum + card.quantity, 0),
    mainNames: new Set(main.map((card) => card.name)).size,
  };
}
