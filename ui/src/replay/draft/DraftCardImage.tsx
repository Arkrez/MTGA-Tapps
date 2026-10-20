/**
 * One draft card: its Scryfall image through the replay's rate-limited image
 * queue (shared with game replays), or a drawn card frame — name, cost, type
 * and rarity — while loading and for cards Scryfall does not have yet.
 */
import { memo, useEffect, useState } from 'react';
import { ImageQueue, resolveCardImage, resolvedImageCache, scryfallRateLimiter } from '../images';
import type { ReplayCard } from '../types';
import type { DraftCard } from './types';

const queue = new ImageQueue({ limiter: scryfallRateLimiter });

function asReplayCard(card: DraftCard): ReplayCard {
  const types = card.types ?? [];
  return {
    name: card.name,
    arena_id: card.arena_id,
    type_line: types.join(' ') || null,
    primary_type: types[types.length - 1] ?? null,
    power: null,
    toughness: null,
    mana_cost: card.mana_cost ?? null,
    color_identity: card.colors ?? null,
    is_token: false,
    image_url: null,
    faces: [],
  };
}

function imageKey(card: DraftCard): string {
  return `arena:${card.arena_id}`;
}

function useCardImage(card: DraftCard, priority: number): string | null {
  const key = imageKey(card);
  const [found, setFound] = useState<{ key: string; url: string | null } | null>(null);
  useEffect(() => {
    if (resolvedImageCache.get(key)) return;
    let live = true;
    resolveCardImage(key, asReplayCard(card), queue, { priority }).then(
      (url) => live && setFound({ key, url }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [card, key, priority]);
  return resolvedImageCache.get(key) ?? (found?.key === key ? found.url : null);
}

function colorClass(colors: string | undefined): string {
  if (!colors) return 'draft-frame-c';
  if (colors.length > 1) return 'draft-frame-m';
  return `draft-frame-${colors.toLowerCase()}`;
}

interface DraftCardImageProps {
  card: DraftCard;
  /** Higher loads first (the current pack before the pool). */
  priority?: number;
  className?: string;
}

export const DraftCardImage = memo(function DraftCardImage({ card, priority = 0, className = '' }: DraftCardImageProps) {
  const url = useCardImage(card, priority);
  const [failed, setFailed] = useState(false);
  const label = `${card.name} (${card.rarity})`;
  return (
    <div className={`draft-card ${className}`} title={label}>
      {url && !failed ? (
        <img src={url} alt={label} loading="lazy" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <div className={`draft-frame ${colorClass(card.colors)}`} role="img" aria-label={label}>
          <span className="draft-frame-name">{card.name}</span>
          {card.mana_cost ? <span className="draft-frame-cost">{card.mana_cost.replace(/[{}]/g, '')}</span> : null}
          <span className="draft-frame-type">{(card.types ?? []).join(' ')}</span>
        </div>
      )}
      <span className={`draft-rarity draft-rarity-${card.rarity}`} aria-hidden="true" />
    </div>
  );
});
