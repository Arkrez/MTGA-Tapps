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

  it('lists games newest first with result, state badge and replay link', async () => {
    const fetchMock = stubGames([
      row(1, { replay: { state: 'recorded', reason: null } }),
      row(2, { replay: { state: 'unavailable', reason: 'no events' } }),
      row(3),
    ]);
    render(<ReplayListPage />);

    expect(await screen.findByRole('table', { name: 'Games to replay' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/games', expect.anything());
    const rows = bodyRows();
    expect(rows.map((tr) => tr.getAttribute('data-game-id'))).toEqual(['game-3', 'game-2', 'game-1']);
    expect(within(rows[0]).getByText('Reconstructed')).toHaveClass('replay-state-reconstructed');
    expect(within(rows[1]).getByText('Unavailable')).toHaveAttribute('title', 'Replay unavailable: no events');
    expect(within(rows[1]).getByRole('button', { name: /^Watch replay: Boros Mouse vs Rival2/ })).toBeDisabled();
    expect(within(rows[2]).getByText('Recorded')).toHaveClass('replay-state-recorded');
    expect(within(rows[2]).getByRole('link', { name: /^Watch replay: Dimir Control vs Rival1, / })).toHaveAttribute(
      'href',
      '#/replay/game-1?return=%23%2Freplay',
    );
    expect(within(rows[0]).getByText('Loss')).toBeInTheDocument();
  });

  it('shows the opponent name before their colors, with a fallback', async () => {
    stubGames([row(1), row(2, { opponent_name: null, opp_colors: '' })]);
    render(<ReplayListPage />);
    await screen.findByRole('table', { name: 'Games to replay' });
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
      row(2, { best_of: 3, game_number: 2, format_label: 'Standard Best-of-3', match_id: 'match-1' }),
    ]);
    render(<ReplayListPage />);
    await screen.findByRole('table', { name: 'Games to replay' });
    expect(bodyRows()).toHaveLength(2);
    expect(screen.getByText(/Game 2$/)).toBeInTheDocument();
  });

  it('filters by deck text and format family', async () => {
    stubGames([
      row(1),
      row(2),
      row(4, { format_label: 'Historic Brawl', deck_name: 'Brawl Pile' }),
    ]);
    render(<ReplayListPage />);
    await screen.findByRole('table', { name: 'Games to replay' });
    expect(bodyRows()).toHaveLength(3);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter by deck' }), { target: { value: 'dimir' } });
    expect(bodyRows().map((tr) => tr.getAttribute('data-game-id'))).toEqual(['game-1']);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter by deck' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Brawl' }));
    expect(bodyRows().map((tr) => tr.getAttribute('data-game-id'))).toEqual(['game-4']);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter by deck' }), { target: { value: 'nope' } });
    expect(screen.getByText('No games match these filters.')).toBeInTheDocument();
  });

  it('pages 25 at a time with Show more', async () => {
    stubGames(Array.from({ length: 30 }, (_, index) => row(index)));
    render(<ReplayListPage />);
    await screen.findByRole('table', { name: 'Games to replay' });
    expect(bodyRows()).toHaveLength(25);
    expect(screen.getByText('Showing 25 of 30')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(bodyRows()).toHaveLength(30);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('opens the replay when a row is clicked, but not for unavailable games', async () => {
    stubGames([row(1), row(2, { replay: { state: 'unavailable', reason: 'no events' } })]);
    render(<ReplayListPage />);
    await screen.findByRole('table', { name: 'Games to replay' });
    const [unavailable, available] = bodyRows();

    await act(async () => {
      fireEvent.click(within(unavailable).getByText('Boros Mouse'));
    });
    expect(window.location.hash).toBe('#/replay');

    await act(async () => {
      fireEvent.click(within(available).getByText('Dimir Control'));
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
