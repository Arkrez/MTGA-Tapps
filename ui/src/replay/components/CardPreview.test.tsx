import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { card } from '../fixtures/streamBuilder';
import { ImageQueue, resolvedImageCache } from '../images';
import { HoverStore } from '../scene/hoverStore';
import { TextureStore } from '../scene/textureStore';
import { CardPreview } from './CardPreview';

const LARGE = 'https://cards.scryfall.io/large/front/g/g/goblin.jpg';

describe('CardPreview', () => {
  beforeEach(() => resolvedImageCache.reset(true));
  afterEach(() => vi.restoreAllMocks());

  it('never points an <img> at api.scryfall.com: lookups go through the rate-limited queue', async () => {
    let finish!: (url: string) => void;
    const resolve = vi.fn<(url: string) => Promise<string>>(
      () =>
        new Promise<string>((done) => {
          finish = done;
        }),
    );
    const store = new TextureStore(
      {
        a9: card('Goblin Guide', 'Creature', { arena_id: 9 }),
        a2: card('Bear', 'Creature', { image_url: 'https://cards.scryfall.io/normal/front/b/2/bear.jpg' }),
      },
      { queue: new ImageQueue({ resolve }) },
    );
    const hover = new HoverStore();
    render(<CardPreview hover={hover} store={store} />);

    act(() => hover.set({ key: 'scene:1', card: 'a9', name: 'Goblin Guide', x: 10, y: 10, source: 'scene' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Goblin Guide');
    expect(screen.queryByRole('img')).toBeNull();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0][0]).toContain('api.scryfall.com');

    // Pointer moves over the same card do not start another lookup.
    act(() => hover.set({ key: 'scene:1', card: 'a9', name: 'Goblin Guide', x: 20, y: 30, source: 'scene' }));
    expect(resolve).toHaveBeenCalledTimes(1);

    await act(async () => finish(LARGE));
    expect(screen.getByRole('img')).toHaveAttribute('src', LARGE);

    // A card with a CDN image previews immediately, without the queue.
    act(() => hover.set({ key: 'scene:2', card: 'a2', name: 'Bear', x: 10, y: 10, source: 'scene' }));
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cards.scryfall.io/large/front/b/2/bear.jpg');
    expect(resolve).toHaveBeenCalledTimes(1);
    for (const image of screen.queryAllByRole('img')) {
      expect(image.getAttribute('src')).not.toContain('api.scryfall.com');
    }
    store.dispose();
  });

  it('falls back to the procedural face when no image exists anywhere', async () => {
    const store = new TextureStore(
      { 'n:Treefolk': card('Treefolk', 'Creature', { is_token: true, power: '*', toughness: '4' }) },
      { queue: new ImageQueue({ resolve: async () => Promise.reject(new Error('404')), burst: 10 }) },
    );
    vi.spyOn(store, 'generatedFaceUrl').mockReturnValue('data:image/png;base64,AAAA');
    const hover = new HoverStore();
    render(<CardPreview hover={hover} store={store} />);
    await act(async () => hover.set({ key: 'scene:3', card: 'n:Treefolk', name: 'Treefolk', x: 10, y: 10, source: 'scene' }));
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
    const image = screen.getByRole('img');
    expect(image).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(image).toHaveClass('card-preview-generated');
    expect(screen.queryByText('Card image unavailable')).toBeNull();
    store.dispose();
  });
});
