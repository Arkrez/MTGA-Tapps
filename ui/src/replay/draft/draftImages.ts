/**
 * Card art for a whole draft, resolved up front: one batch lookup by name
 * for every card in the stream (a draft is 150–250 distinct cards, so three
 * or four requests), then the per-card queue only for what the batch missed.
 * Resolved URLs live in the shared `resolvedImageCache`, so a second visit
 * is instant. Images on the current and next picks are preloaded so
 * stepping never waits for a download.
 */
import { useEffect, useMemo, useState } from 'react';
import { ImageQueue, prewarmCardImages, resolveCardImage, resolvedImageCache, scryfallRateLimiter } from '../images';
import type { ReplayCard } from '../types';
import type { DraftCard, DraftStream } from './types';

const queue = new ImageQueue({ limiter: scryfallRateLimiter });

export function draftImageKey(arenaId: number): string {
  return `arena:${arenaId}`;
}

export function asReplayCard(card: DraftCard): ReplayCard {
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

export interface DraftImages {
  /** Final image URL for a card, or null (still loading, or no art anywhere). */
  url: (arenaId: number) => string | null;
  /** True once every card has an answer (an image or a known miss). */
  settled: boolean;
}

/** Cards on screen first: they go in the small first batch. */
const FIRST_BATCH = 30;

export function useDraftImages(stream: DraftStream, firstShown: readonly number[] = []): DraftImages {
  const [version, setVersion] = useState(0);
  const [settledFor, setSettledFor] = useState<DraftStream | null>(null);

  useEffect(() => {
    let live = true;
    const rank = new Map(firstShown.map((arenaId, n) => [arenaId, n]));
    const cards = Object.values(stream.cards).sort(
      (a, b) => (rank.get(a.arena_id) ?? Infinity) - (rank.get(b.arena_id) ?? Infinity),
    );
    const entries = cards.map((card) => ({ key: draftImageKey(card.arena_id), card: asReplayCard(card) }));
    void (async () => {
      const missing = await prewarmCardImages(entries, {
        onBatch: () => live && setVersion((v) => v + 1),
        firstBatch: rank.size ? FIRST_BATCH : undefined,
      }).catch(() => new Set<string>());
      if (!live) return;
      setVersion((v) => v + 1);
      // Only cards the batch could not answer (a request failed, or a name it
      // did not know) take the slower per-card path: Arena id, then exact name.
      const rest = entries.filter((entry) => !resolvedImageCache.get(entry.key) && !missing.has(entry.key));
      await Promise.all(
        rest.map((entry) =>
          resolveCardImage(entry.key, entry.card, queue).then(
            (url) => live && url && setVersion((v) => v + 1),
            () => undefined,
          ),
        ),
      );
      if (live) setSettledFor(stream);
    })();
    return () => {
      live = false;
    };
    // Only the first render's cards matter for ordering; later steps are preloaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  return useMemo(
    () => ({
      url: (arenaId: number) => resolvedImageCache.get(draftImageKey(arenaId)),
      settled: settledFor === stream,
    }),
    // `version` changes whenever the cache gained URLs this hook asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settledFor, stream, version],
  );
}

const preloaded = new Set<string>();

/** Starts downloading these images into the browser cache (once per URL). */
export function preloadImages(urls: Iterable<string | null>): void {
  if (typeof Image === 'undefined') return;
  for (const url of urls) {
    if (!url || preloaded.has(url)) continue;
    preloaded.add(url);
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
  }
}
