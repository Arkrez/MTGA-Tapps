import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftReplayViewer } from './DraftReplayViewer';
import type { DraftCard, DraftStream } from './types';

function card(arena_id: number, name: string, rarity: DraftCard['rarity'], mana_value = 2): DraftCard {
  return { arena_id, name, rarity, colors: 'G', types: ['Creature'], mana_value, mana_cost: '{1}{G}' };
}

const STREAM: DraftStream = {
  version: 1,
  draft: {
    id: 'd-1',
    kind: 'player',
    event_name: 'PremierDraft_FRA_20260929',
    format_label: 'Premier Draft - FRA',
    started_at: '2026-10-19T14:31:34+00:00',
    updated_at: null,
    completed_at: '2026-10-19T14:58:00+00:00',
  },
  pool: [],
  cards: Object.fromEntries(
    [
      card(1, 'Oak Titan', 'rare', 5),
      card(2, 'Grove Elf', 'common', 1),
      card(3, 'Moss Dragon', 'mythic', 6),
      card(4, 'Fern Scout', 'uncommon'),
      card(11, 'Bark Wolf', 'common'),
      card(12, 'Seed Bear', 'common'),
    ].map((c) => [String(c.arena_id), c]),
  ),
  // Two drafters: the pick-1 pack comes back at pick 3.
  picks: [
    { pack: 1, pick: 1, pack_cards: [1, 2, 3, 4], picked: [1], observed_at: null },
    { pack: 1, pick: 2, pack_cards: [11, 12, 2], picked: [11], observed_at: null },
    { pack: 1, pick: 3, pack_cards: [2, 4], picked: [4], observed_at: null },
  ],
};

describe('DraftReplayViewer', () => {
  beforeEach(() => {
    // No Scryfall in tests: every card falls back to its drawn frame.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    window.location.hash = '#/replay/draft/d-1';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  it('shows the pack, the pick and the deck so far', () => {
    render(<DraftReplayViewer stream={STREAM} step={null} returnHash={null} />);
    expect(screen.getByRole('heading', { name: /Premier Draft - FRA/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pack 1 · Pick 1' })).toBeInTheDocument();
    expect(screen.getByText(/First look at this pack/)).toBeInTheDocument();
    const pack = screen.getByRole('region', { name: 'Pack' });
    expect(within(pack).getAllByRole('img')).toHaveLength(4);
    expect(within(pack).getByRole('img', { name: 'Oak Titan (rare)' }).closest('.draft-card')).toHaveClass('draft-card-picked');
    expect(screen.getByText('1 cards')).toBeInTheDocument();
  });

  it('steps to a pack seen before and lists the missing cards rarest first', () => {
    render(<DraftReplayViewer stream={STREAM} step="p1p3" returnHash={null} />);
    expect(screen.getByRole('heading', { name: 'Pack 1 · Pick 3' })).toBeInTheDocument();
    expect(screen.getByText(/wheeled from Pick 1/)).toBeInTheDocument();
    const missing = screen.getByRole('region', { name: 'Missing since pick 1' });
    expect(within(missing).getAllByRole('img').map((img) => img.getAttribute('aria-label'))).toEqual([
      'Moss Dragon (mythic)',
      'Oak Titan (rare)',
    ]);
    expect(within(missing).getByText('Your pick')).toBeInTheDocument();
    expect(screen.getByText('3 cards')).toBeInTheDocument();
  });

  it('steps with the keyboard and hides picks until revealed', () => {
    render(<DraftReplayViewer stream={STREAM} step={null} returnHash={null} />);
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    expect(screen.getByRole('heading', { name: 'Pack 1 · Pick 2' })).toBeInTheDocument();
    expect(screen.getByText('2 cards')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide picks' }));
    expect(screen.getByText('1 cards')).toBeInTheDocument();
    expect(document.querySelector('.draft-card-picked')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal pick (R)' }));
    expect(screen.getByText('2 cards')).toBeInTheDocument();
    const pack = screen.getByRole('region', { name: 'Pack' });
    expect(within(pack).getByRole('img', { name: 'Bark Wolf (common)' }).closest('.draft-card')).toHaveClass('draft-card-picked');
    const pool = screen.getByRole('complementary', { name: 'Deck so far' });
    expect(within(pool).getByRole('img', { name: 'Bark Wolf (common)' }).closest('.draft-card')).toHaveClass('draft-card-new');

    act(() => {
      fireEvent.keyDown(window, { key: 'Home' });
    });
    expect(screen.getByRole('heading', { name: 'Pack 1 · Pick 1' })).toBeInTheDocument();
  });
});
