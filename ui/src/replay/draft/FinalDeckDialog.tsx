/**
 * The deck built from the draft, in Deck Manager's dialog layout: summary
 * line, then the main deck and sideboard as quantity lists (with the usual
 * card hover previews).
 */
import { CardLink } from '../../components/CardLink';
import { ColorPips } from '../../components/ColorPips';
import { DeckModal } from '../../components/DeckModal';
import { formatDateTime } from '../../format';
import { cardFor } from './model';
import type { DraftDeck, DraftDeckCard, DraftStream } from './types';

const count = (cards: DraftDeckCard[]) => cards.reduce((sum, card) => sum + card.quantity, 0);

function sorted(stream: DraftStream, cards: DraftDeckCard[]): DraftDeckCard[] {
  const land = (card: DraftDeckCard) => (cardFor(stream, card.arena_id).types?.includes('Land') ? 1 : 0);
  return [...cards].sort((a, b) => {
    const ca = cardFor(stream, a.arena_id);
    const cb = cardFor(stream, b.arena_id);
    return land(a) - land(b) || (ca.mana_value ?? 0) - (cb.mana_value ?? 0) || ca.name.localeCompare(cb.name);
  });
}

function Section({ stream, title, cards, returnHash }: { stream: DraftStream; title: string; cards: DraftDeckCard[]; returnHash: string }) {
  return (
    <section className="deck-detail-section" aria-label={`${title} (${count(cards)})`}>
      <h4>
        {title}
        <span>{count(cards)}</span>
      </h4>
      <ul>
        {sorted(stream, cards).map((card) => {
          const name = cardFor(stream, card.arena_id).name;
          return (
            <li key={`${title}-${card.arena_id}`}>
              <span className="deck-detail-quantity">{card.quantity}</span>
              {name.startsWith('Card #') ? <span>{name}</span> : <CardLink cardName={name} returnHash={returnHash} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function FinalDeckDialog({
  stream,
  deck,
  returnHash,
  returnFocus,
  onClose,
}: {
  stream: DraftStream;
  deck: DraftDeck;
  returnHash: string;
  returnFocus: HTMLElement | null;
  onClose: () => void;
}) {
  const colors = [...new Set(deck.main.flatMap((card) => [...(cardFor(stream, card.arena_id).colors ?? '')]))].join('');
  const summary = [
    stream.draft.format_label,
    `${count(deck.main)} cards`,
    deck.sideboard.length ? `${count(deck.sideboard)} sideboard` : null,
    deck.submitted_at ? `submitted ${formatDateTime(deck.submitted_at)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <DeckModal title={deck.name || 'Draft deck'} busy={false} onClose={onClose} returnFocus={returnFocus} wide>
      <div className="deck-detail">
        <div className="deck-detail-summary">
          <p>
            <ColorPips colors={colors} size={16} />
            {summary}
          </p>
        </div>
        <div className={`deck-detail-lists${deck.sideboard.length ? '' : ' deck-detail-lists-single'}`}>
          <Section stream={stream} title="Deck" cards={deck.main} returnHash={returnHash} />
          {deck.sideboard.length ? (
            <div className="deck-detail-side">
              <Section stream={stream} title="Sideboard" cards={deck.sideboard} returnHash={returnHash} />
            </div>
          ) : null}
        </div>
      </div>
    </DeckModal>
  );
}
