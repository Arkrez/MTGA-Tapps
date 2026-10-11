import type { ParsedDeckImport } from '../deckFinderImport';

export function DeckFinderDeckList({ deck }: { deck: ParsedDeckImport }) {
  return (
    <>
      {deck.sections.map((section, sectionIndex) => (
        <div className="deckfinder-import-section" key={`${section.name}-${sectionIndex}`}>
          <h4>{section.name}</h4>
          <ul className="deckfinder-card-list" aria-label={`${section.name} cards`}>
            {section.cards.map((card, index) => (
              <li key={`${card.name}-${index}`}>
                <span className="deckfinder-card-quantity">{card.quantity}</span>
                <span>{card.name}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
