/**
 * One draft card: its image (resolved for the whole draft by
 * `useDraftImages`), or a drawn card frame — name, cost, type and rarity —
 * while loading and for cards Scryfall does not have yet. A failed download
 * is retried once before falling back to the frame.
 */
import { memo, useState, type ReactNode } from 'react';
import type { DraftCard } from './types';

function colorClass(colors: string | undefined): string {
  if (!colors) return 'draft-frame-c';
  if (colors.length > 1) return 'draft-frame-m';
  return `draft-frame-${colors.toLowerCase()}`;
}

function retryUrl(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}retry=1`;
}

interface DraftCardImageProps {
  card: DraftCard;
  url: string | null;
  className?: string;
  /** Extra badge drawn over the card (e.g. "In deck"). */
  badge?: ReactNode;
}

export const DraftCardImage = memo(function DraftCardImage({ card, url, className = '', badge }: DraftCardImageProps) {
  const [failures, setFailures] = useState<{ url: string | null; count: number }>({ url: null, count: 0 });
  const attempts = failures.url === url ? failures.count : 0;
  const src = url && attempts < 2 ? (attempts === 1 ? retryUrl(url) : url) : null;
  const label = `${card.name} (${card.rarity})`;
  return (
    <div className={`draft-card ${className}`} title={label}>
      {src ? (
        <img src={src} alt={label} draggable={false} onError={() => setFailures({ url, count: attempts + 1 })} />
      ) : (
        <div className={`draft-frame ${colorClass(card.colors)}`} role="img" aria-label={label}>
          <span className="draft-frame-name">{card.name}</span>
          {card.mana_cost ? <span className="draft-frame-cost">{card.mana_cost.replace(/[{}]/g, '')}</span> : null}
          <span className="draft-frame-type">{(card.types ?? []).join(' ')}</span>
        </div>
      )}
      <span className={`draft-rarity draft-rarity-${card.rarity}`} aria-hidden="true" />
      {badge}
    </div>
  );
});
