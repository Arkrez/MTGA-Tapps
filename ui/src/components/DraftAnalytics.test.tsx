import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DraftAnalytics as DraftAnalyticsData, DraftCardStats, DraftTally } from '../replay/draft/types';
import { DraftAnalytics } from './DraftAnalytics';

function tally(drafts: number, wins: number, losses: number): DraftTally {
  return { drafts, wins, losses, games: wins + losses, win_rate: wins + losses ? wins / (wins + losses) : null };
}

function card(arena_id: number, name: string, inDeck: DraftTally, picked: DraftTally): DraftCardStats {
  return { arena_id, name, rarity: 'common', colors: 'G', in_deck: inDeck, picked, first_picks: 0, avg_pick: 5 };
}

const DATA: DraftAnalyticsData = {
  summary: tally(3, 5, 3),
  colors: [{ colors: 'BG', ...tally(3, 5, 3) }],
  formats: [{ format_label: 'Premier Draft - FRA', ...tally(3, 5, 3) }],
  cards: [
    card(1, 'Alpha', tally(2, 5, 1), tally(2, 5, 1)),
    card(2, 'Gamma', tally(0, 0, 0), tally(1, 1, 1)),
  ],
  pairs: {
    best: [{ cards: [{ arena_id: 1, name: 'Alpha', rarity: 'common', colors: 'G' }, { arena_id: 3, name: 'Beta', rarity: 'rare', colors: 'G' }], ...tally(2, 8, 2) }],
    worst: [],
  },
  pair_rules: { min_drafts: 2, min_games: 4 },
};

describe('DraftAnalytics', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the overview, per-card win rates and notable pairs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DATA), { status: 200 })));
    render(<DraftAnalytics />);

    const overview = await screen.findByRole('tabpanel', { name: 'Overview' });
    const record = within(overview).getByRole('region', { name: 'Draft record' });
    expect(within(record).getByText('5–3')).toBeInTheDocument();
    expect(within(record).getByText('63%')).toBeInTheDocument();
    expect(within(overview).getByRole('table', { name: 'By event' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Cards' }));
    const cards = screen.getByRole('table', { name: 'Your win rate by card' });
    expect(within(cards).getByText('Alpha')).toBeInTheDocument();
    // In deck and when picked: same drafts in this fixture, so both read 83%.
    expect(within(cards).getAllByText('83% WR')).toHaveLength(2);
    // Gamma has only 2 games, under the default minimum of 3.
    expect(within(cards).queryByText('Gamma')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } });
    expect(within(screen.getByRole('table', { name: 'Your win rate by card' })).getByText('Gamma')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Card pairs' }));
    const best = screen.getByRole('region', { name: 'Best together' });
    expect(within(best).getByText('Beta')).toBeInTheDocument();
    expect(within(best).getByText('80% WR')).toBeInTheDocument();
    expect(within(best).getByText('8–2 · 2 drafts')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Worst together' })).getByText('No pair has enough games yet.')).toBeInTheDocument();
  });

  it('explains when no drafted deck has played yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ...DATA, summary: tally(0, 0, 0) }), { status: 200 })),
    );
    render(<DraftAnalytics />);
    expect(await screen.findByText(/appear once you have played games/)).toBeInTheDocument();
  });
});
