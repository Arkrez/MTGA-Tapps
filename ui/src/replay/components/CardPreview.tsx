/**
 * One hover preview for the whole replay page (scene meshes and log card
 * names), styled like CardLink's `.card-preview`. A single delegated preview
 * keeps hundreds of log rows from each mounting their own floating tooltip.
 * Images that need an api.scryfall.com lookup go through the page's
 * rate-limited queue instead of an `<img>` pointed at the API, so sweeping
 * the pointer across the log never exceeds the shared request budget.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { formatCardName } from '../../format';
import { previewPosition } from '../scene/hoverStore';
import type { HoverStore } from '../scene/hoverStore';
import type { TextureStore } from '../scene/textureStore';
import type { CardKey } from '../types';

function PreviewImage({ url, name, fallback }: { url: string | null; name: string; fallback: string | null }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  if (url === null || state === 'failed') {
    if (fallback) {
      return (
        <img
          className="card-preview-image card-preview-image-loaded card-preview-generated"
          src={fallback}
          alt={`${formatCardName(name)} card preview`}
        />
      );
    }
    return (
      <div className="card-preview-fallback">
        <strong>{formatCardName(name)}</strong>
        <span>Card image unavailable</span>
      </div>
    );
  }
  return (
    <>
      {state === 'loading' ? <div className="card-preview-loading">{formatCardName(name)}</div> : null}
      <img
        className={state === 'loaded' ? 'card-preview-image card-preview-image-loaded' : 'card-preview-image'}
        src={url}
        alt={`${formatCardName(name)} card preview`}
        onLoad={() => setState('loaded')}
        onError={() => setState('failed')}
      />
    </>
  );
}

interface Lookup {
  id: string;
  url: string | null;
}

/** Preview URL for the hovered card: immediate when known, else looked up once per hover target. */
function usePreviewUrl(store: TextureStore, card: CardKey | null, name: string): string | null | undefined {
  const immediate = store.previewUrlNow(card);
  const id = `${card ?? ''}|${name}`;
  const [lookup, setLookup] = useState<Lookup | null>(null);
  useEffect(() => {
    if (immediate || !name) return;
    let live = true;
    store.resolvePreview(card, name).then(
      (url) => {
        if (live) setLookup({ id, url });
      },
      () => {
        if (live) setLookup({ id, url: null });
      },
    );
    return () => {
      live = false;
    };
  }, [store, card, name, id, immediate]);
  if (immediate) return immediate;
  return lookup?.id === id ? lookup.url : undefined;
}

export function PreviewCard({ store, card, name }: { store: TextureStore; card: CardKey | null; name: string }) {
  const url = usePreviewUrl(store, card, name);
  if (url === undefined) {
    return <div className="card-preview-loading">{formatCardName(name)}</div>;
  }
  // No image anywhere (a token Scryfall has not printed): the procedural face.
  return <PreviewImage key={url ?? 'none'} url={url} name={name} fallback={url ? null : store.generatedFaceUrl(card)} />;
}

export function CardPreview({ hover, store }: { hover: HoverStore; store: TextureStore }) {
  const info = useSyncExternalStore(hover.subscribe, hover.get);
  if (!info || !info.name) return null;
  const { left, top, width } = previewPosition(info, { width: window.innerWidth, height: window.innerHeight });
  return (
    <div
      className="card-preview replay-card-preview"
      role="tooltip"
      data-card-name={info.name}
      style={{ position: 'fixed', left, top, width }}
    >
      <div className="card-preview-media">
        <PreviewCard key={`${info.card ?? ''}|${info.name}`} store={store} card={info.card} name={info.name} />
      </div>
    </div>
  );
}
