import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DraftAnalytics as DraftAnalyticsData, DraftCardStats, DraftTally } from '../replay/draft/types';
import { DraftAnalytics } from './DraftAnalytics';

function tally(drafts: number, wins: number, losses: number): DraftTally {
  return { drafts, wins, losses, games: wins + losses, win_rate: wins + losses ? wins / (wins + losses) : null };
}

function card(arena_id: number, name: string, inHand: DraftTally, picked: number, inDeck: number): DraftCardStats {
  return { arena_id, name, rarity: 'common', colors: 'G', in_hand: inHand, picked, in_deck: inDeck, first_picks: 0, avg_pick: 5 };
}

const DATA: DraftAnalyticsData = {
  summary: tally(3, 5, 3),
  colors: [{ colors: 'BG', ...tally(3, 5, 3) }],
  formats: [{ format_label: 'Premier Draft - FRA', ...tally(3, 5, 3) }],
  cards: [
    card(1, 'Alpha', tally(2, 5, 1), 2, 2),
    // Picked and played, but never in hand: no win rate.
    card(2, 'Gamma', tally(0, 0, 0), 1, 1),
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
    expect(within(cards).getByText('83% WR')).toBeInTheDocument();
    expect(within(cards).getByRole('columnheader', { name: /Win rate in hand/ })).toBeInTheDocument();
    // Gamma was never in hand, under the default minimum of 3 games.
    expect(within(cards).queryByText('Gamma')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } });
    const all = screen.getByRole('table', { name: 'Your win rate by card' });
    const gamma = within(all).getByText('Gamma').closest('tr') as HTMLElement;
    expect(within(gamma).getAllByText('—').length).toBeGreaterThan(0);

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
