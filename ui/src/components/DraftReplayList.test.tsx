import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftReplayList } from './DraftReplayList';

const DRAFT = {
  id: 'bot-c1',
  kind: 'bot',
  event_name: 'QuickDraft_FRA_20261001',
  format_label: 'Quick Draft - FRA',
  started_at: '2026-10-19T14:02:09+00:00',
  updated_at: null,
  completed_at: null,
  picks: 41,
  packs: 3,
  colors: 'UR',
  first_pick: { arena_id: 106314, name: 'Fulminous Forte' },
  record: { wins: 7, losses: 1, games: 8 },
};

describe('DraftReplayList', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  it('lists drafts and rescans the Arena logs on request', async () => {
    let drafts: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://api.scryfall.com/cards/collection') {
        const { identifiers } = JSON.parse(String(init?.body)) as { identifiers: Array<{ name: string }> };
        const data = identifiers.map(({ name }) => ({
          name: 'Fulminous Forte',
          image_uris: { normal: `https://cards.scryfall.io/normal/front/f/f/${name.replace(/ /g, '-')}.jpg` },
        }));
        return new Response(JSON.stringify({ data, not_found: [] }), { status: 200 });
      }
      if (url === '/api/drafts/import-log') {
        expect(init?.method).toBe('POST');
        drafts = [DRAFT];
        return new Response(JSON.stringify({ drafts: 1, logs: ['Player-prev.log', 'Player.log'] }), { status: 200 });
      }
      return new Response(JSON.stringify({ drafts }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<DraftReplayList />);
    expect(await screen.findByText(/No drafts recorded yet/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Find past drafts in Arena logs' }));
    expect(await screen.findByText(/Checked Player-prev.log and Player.log: 1 draft found/)).toBeInTheDocument();
    const tiles = await screen.findByRole('list', { name: 'Drafts and sealed runs' });
    const tile = within(tiles).getByRole('link', { name: /Quick Draft - FRA/ });
    expect(within(tile).getByText('First pick: Fulminous Forte')).toBeInTheDocument();
    expect(within(tile).getByText('Incomplete')).toBeInTheDocument();
    expect(within(tile).getByText(/41 picks/)).toBeInTheDocument();
    expect(within(tile).getByText('88% WR')).toHaveAttribute('title', '7–1 (88% of decided games)');
    expect(within(tile).getByText('7–1')).toBeInTheDocument();
    expect(tile).toHaveAttribute('href', `#/replay/draft/bot-c1?return=${encodeURIComponent('#/replay')}`);
    // Tile art comes from one batched Scryfall lookup, then the CDN's art crop.
    expect(await within(tile).findByRole('img', { name: 'Fulminous Forte' })).toHaveAttribute(
      'src',
      'https://cards.scryfall.io/art_crop/front/f/f/fulminous-forte.jpg',
    );
  });

  it('shows sealed and rebuilt runs with their own records', async () => {
    const sealed = {
      ...DRAFT,
      id: 'sealed-c9',
      kind: 'sealed',
      format_label: 'Sealed - TRK',
      picks: 0,
      packs: 0,
      first_pick: null,
      top_card: { arena_id: 7, name: 'Jadzia Dax, Living Legacy' },
      pool_size: 84,
      completed_at: '2026-11-12T06:00:00+00:00',
      record: { wins: 3, losses: 3, games: 6 },
    };
    const rebuilt = { ...sealed, id: 'games-g1', rebuilt: true, completed_at: null, record: { wins: 0, losses: 2, games: 2 } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ drafts: [sealed, rebuilt] }), { status: 200 })));
    render(<DraftReplayList />);
    const tiles = await screen.findByRole('list', { name: 'Drafts and sealed runs' });
    const [first, second] = within(tiles).getAllByRole('link');
    expect(within(first).getByText('Best card: Jadzia Dax, Living Legacy')).toBeInTheDocument();
    expect(within(first).getByText(/Sealed pool · 84 cards/)).toBeInTheDocument();
    expect(within(first).getByText('3–3')).toBeInTheDocument();
    expect(within(second).getByText(/Rebuilt from games/)).toBeInTheDocument();
    expect(within(second).getByText('0–2')).toBeInTheDocument();
    expect(second).toHaveAttribute('href', `#/replay/draft/games-g1?return=${encodeURIComponent('#/replay')}`);
  });
});
