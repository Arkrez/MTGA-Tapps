/**
 * Art crops for many tiles at once. Each tile asking api.scryfall.com for its
 * own art (the redirecting image endpoint) trips Scryfall's rate limit on a
 * page of 50+ tiles and the tiles give up. Instead every name is looked up in
 * one `/cards/collection` batch (`prewarmCardImages`, cached across visits)
 * and the art comes straight from the cards.scryfall.io CDN.
 */
import { useEffect, useMemo, useState } from 'react';
import { prewarmCardImages, resolvedImageCache } from './images';
import type { ReplayCard } from './types';

function key(name: string): string {
  return `name:${name.toLocaleLowerCase()}`;
}

function nameCard(name: string): ReplayCard {
  return {
    name,
    arena_id: null,
    type_line: null,
    primary_type: null,
    power: null,
    toughness: null,
    mana_cost: null,
    color_identity: null,
    is_token: false,
    image_url: null,
    faces: [],
  };
}

/** The CDN art-crop URL for a card name once resolved, else null. */
export function useCardArt(names: readonly (string | null | undefined)[]): (name: string | null | undefined) => string | null {
  const wanted = useMemo(
    () => [...new Set(names.filter((n): n is string => Boolean(n) && !String(n).startsWith('Card #')))].sort(),
    [names],
  );
  const signature = wanted.join('|');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    const entries = signature ? signature.split('|').map((name) => ({ key: key(name), card: nameCard(name) })) : [];
    if (!entries.length) return;
    void prewarmCardImages(entries, { onBatch: () => live && setVersion((v) => v + 1) }).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [signature]);
  return useMemo(
    () => (name) => {
      if (!name) return null;
      const url = resolvedImageCache.get(key(name));
      return url ? url.replace('/normal/', '/art_crop/') : null;
    },
    // `version` bumps whenever a batch filled the cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
}
