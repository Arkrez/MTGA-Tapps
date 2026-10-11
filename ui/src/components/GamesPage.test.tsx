import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchAllGames, type AllGamesRow } from '../api';
import { GamesPage } from './GamesPage';

vi.mock('../api', () => ({ fetchAllGames: vi.fn() }));

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('offers direct page navigation for All Games and resets on format changes', async () => {
  const user = userEvent.setup();
  const games: AllGamesRow[] = Array.from({ length: 240 }, (_, index) => ({
    game_id: `game-${index}`,
    started_at: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
    deck_name: `Deck ${index}`,
    format_label: index < 60 ? 'Historic Best-of-1' : 'Standard Best-of-1',
    outcome: 'win',
    mulligans: 0,
    duration_seconds: 300,
    total_turns: 10,
    cards_seen: 15,
    lands_seen: 6,
    land_seen_pct: 40,
    flood_reasons: [],
    is_flood: false,
  }));
  vi.mocked(fetchAllGames).mockResolvedValue({ games, total: games.length });
  const { rerender } = render(<GamesPage filters={{}} />);
  const pagination = await screen.findByRole('navigation', { name: 'All games pagination' });
  const table = screen.getByRole('table', { name: 'All games' });
  await user.click(within(pagination).getByRole('button', { name: 'Page 4' }));
  expect(within(pagination).getByText('Showing 91-120 of 240')).toBeInTheDocument();
  expect(within(table).getByText('Deck 149')).toBeInTheDocument();
  await user.click(within(pagination).getByRole('button', { name: 'Last page' }));
  expect(within(table).getByText('Deck 0')).toBeInTheDocument();
  expect(within(pagination).getByRole('button', { name: 'Page 8' })).toHaveAttribute('aria-current', 'page');

  await user.click(screen.getByRole('button', { name: 'Historic' }));
  expect(within(pagination).getByText('Page 1 of 2')).toBeInTheDocument();
  expect(within(pagination).getByText('Showing 1-30 of 60')).toBeInTheDocument();
  expect(within(table).getByText('Deck 59')).toBeInTheDocument();
  expect(within(pagination).getByRole('spinbutton', { name: 'Go to page' })).toHaveValue(1);
  await user.click(within(pagination).getByRole('button', { name: 'Page 2' }));
  rerender(<GamesPage filters={{ days: 30 }} />);
  expect(within(pagination).getByText('Page 1 of 2')).toBeInTheDocument();
});
