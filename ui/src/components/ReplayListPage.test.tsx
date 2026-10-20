import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayListPage } from './ReplayListPage';

function row(index: number, overrides: Record<string, unknown> = {}) {
  const minute = String(index).padStart(2, '0');
  return {
    game_id: `game-${index}`,
    match_id: `match-${index}`,
    game_number: 1,
    started_at: `2026-06-05T10:${minute}:00`,
    deck_name: index % 2 === 0 ? 'Boros Mouse' : 'Dimir Control',
    format_label: 'Standard Best-of-1',
    best_of: 1,
    outcome: index % 3 === 0 ? 'loss' : 'win',
    mulligans: 0,
    duration_seconds: 300 + index,
    total_turns: 8,
    flood_reasons: [],
    is_flood: false,
    opp_colors: 'R',
    opponent_name: `Rival${index}`,
    cards_seen: 15,
    lands_seen: 6,
    land_seen_pct: 40,
    replay: { state: 'reconstructed', reason: null },
    ...overrides,
  };
}

function stubGames(games: Array<Record<string, unknown>>) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ games, total: games.length }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function openDeck(name: string) {
  fireEvent.click(await screen.findByTitle(`Show ${name}'s games`));
  await screen.findByRole('table', { name: 'Games to replay' });
}

function tileNames() {
  return within(screen.getByRole('list', { name: 'Decks' }))
    .getAllByRole('button')
    .map((tile) => tile.querySelector('strong')?.textContent);
}

function bodyRows() {
  const table = screen.getByRole('table', { name: 'Games to replay' });
  return within(table).getAllByRole('row').slice(1);
}

describe('ReplayListPage', () => {
  beforeEach(() => {
    window.location.hash = '#/replay';
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  it('groups games into deck tiles, most recently played first', async () => {
    const fetchMock = stubGames([
      row(1, { replay: { state: 'recorded', reason: null } }),
      row(2, { replay: { state: 'unavailable', reason: 'no events' } }),
      row(3),
    ]);
    render(<ReplayListPage />);

    const decks = await screen.findByRole('list', { name: 'Decks' });
    expect(fetchMock).toHaveBeenCalledWith('/api/games', expect.anything());
    const tiles = within(decks).getAllByRole('button');
    expect(tiles.map((tile) => tile.querySelector('strong')?.textContent)).toEqual(['Dimir Control', 'Boros Mouse']);
    expect(within(tiles[0]).getByText(/2 games · 1–1/)).toBeInTheDocument();
    expect(within(tiles[0]).getByText('50% WR')).toBeInTheDocument();
    expect(within(tiles[1]).getByText('100% WR')).toBeInTheDocument();
    expect(within(tiles[1]).getByText('0 replays')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the last game played up front with a Watch replay button', async () => {
    stubGames([row(1), row(5, { replay: { state: 'recorded', reason: null }, outcome: 'win' }), row(3)]);
    render(<ReplayListPage />);
    const latest = await screen.findByRole('region', { name: 'Last played' });
    expect(within(latest).getByRole('heading', { name: /Dimir Control/ })).toBeInTheDocument();
    expect(within(latest).getByText('vs Rival5')).toBeInTheDocument();
    expect(within(latest).getByText('Win')).toBeInTheDocument();
    expect(within(latest).getByRole('link', { name: 'Watch replay' })).toHaveAttribute(
      'href',
      '#/replay/game-5?return=%23%2Freplay',
    );
  });

  it('opens a deck to list its games newest first, and goes back to all decks', async () => {
    stubGames([
      row(1, { replay: { state: 'recorded', reason: null } }),
      row(2, { replay: { state: 'unavailable', reason: 'no events' } }),
      row(3),
    ]);
    render(<ReplayListPage />);
    await openDeck('Dimir Control');

    const rows = bodyRows();
    expect(rows.map((tr) => tr.getAttribute('data-game-id'))).toEqual(['game-3', 'game-1']);
    expect(within(rows[0]).getByText('Reconstructed')).toHaveClass('replay-state-reconstructed');
    expect(within(rows[0]).getByText('Loss')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Recorded')).toHaveClass('replay-state-recorded');
    expect(within(rows[1]).getByRole('link', { name: /^Watch replay: Dimir Control vs Rival1, / })).toHaveAttribute(
      'href',
      '#/replay/game-1?return=%23%2Freplay',
    );

    fireEvent.click(screen.getByRole('button', { name: '← All decks' }));
    await openDeck('Boros Mouse');
    const [only] = bodyRows();
    expect(within(only).getByText('Unavailable')).toHaveAttribute('title', 'Replay unavailable: no events');
    expect(within(only).getByRole('button', { name: /^Watch replay: Boros Mouse vs Rival2/ })).toBeDisabled();
  });

  it('shows the opponent name before their colors, with a fallback', async () => {
    stubGames([row(1), row(3, { opponent_name: null, opp_colors: '' })]);
    render(<ReplayListPage />);
    await openDeck('Dimir Control');
    const table = screen.getByRole('table', { name: 'Games to replay' });
    const headers = within(table).getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toContain('Opponent');
    expect(headers.indexOf('Opponent')).toBe(headers.indexOf('Deck') + 1);
    const [second, first] = bodyRows();
    const named = within(first).getByText('Rival1');
    expect(named.closest('.replay-opponent')?.querySelector('.color-pips')).not.toBeNull();
    expect(within(second).getByText('Opponent')).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Turns' })).toHaveClass('replay-col-turns');
  });

  it('labels each game of a Bo3 match', async () => {
    stubGames([
      row(1, { best_of: 3, game_number: 1, format_label: 'Standard Best-of-3' }),
      row(3, { best_of: 3, game_number: 2, format_label: 'Standard Best-of-3', match_id: 'match-1' }),
    ]);
    render(<ReplayListPage />);
    await openDeck('Dimir Control');
    expect(bodyRows()).toHaveLength(2);
    expect(screen.getByText(/Game 2$/)).toBeInTheDocument();
  });

  it('filters deck tiles by deck text and format family', async () => {
    stubGames([
      row(1),
      row(2),
      row(4, { format_label: 'Historic Brawl', deck_name: 'Brawl Pile' }),
    ]);
    render(<ReplayListPage />);
    await screen.findByRole('list', { name: 'Decks' });
    expect(tileNames()).toEqual(['Brawl Pile', 'Boros Mouse', 'Dimir Control']);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter by deck' }), { target: { value: 'dimir' } });
    expect(tileNames()).toEqual(['Dimir Control']);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter by deck' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Brawl' }));
    expect(tileNames()).toEqual(['Brawl Pile']);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter by deck' }), { target: { value: 'nope' } });
    expect(screen.getByText('No games match these filters.')).toBeInTheDocument();
  });

  it("pages a deck's games 25 at a time with Show more", async () => {
    stubGames(Array.from({ length: 30 }, (_, index) => row(index, { deck_name: 'Boros Mouse' })));
    render(<ReplayListPage />);
    await openDeck('Boros Mouse');
    expect(bodyRows()).toHaveLength(25);
    expect(screen.getByText('Showing 25 of 30')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(bodyRows()).toHaveLength(30);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('opens the replay when a row is clicked, but not for unavailable games', async () => {
    stubGames([row(1), row(3, { replay: { state: 'unavailable', reason: 'no events' } })]);
    render(<ReplayListPage />);
    await openDeck('Dimir Control');
    const [unavailable, available] = bodyRows();

    await act(async () => {
      fireEvent.click(within(unavailable).getByText('Rival3'));
    });
    expect(window.location.hash).toBe('#/replay');

    await act(async () => {
      fireEvent.click(within(available).getByText('Rival1'));
    });
    expect(window.location.hash).toBe('#/replay/game-1?return=%23%2Freplay');
  });

  it('shows an empty state when there are no games', async () => {
    stubGames([]);
    render(<ReplayListPage />);
    expect(await screen.findByText(/No tracked games yet/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
