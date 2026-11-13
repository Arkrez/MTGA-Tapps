import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LimitedRunView } from './LimitedRunView';
import type { DraftCard, DraftStream } from './types';

function card(arena_id: number, name: string, rarity: DraftCard['rarity'], mana_value = 2): DraftCard {
  return { arena_id, name, rarity, colors: 'U', types: ['Creature'], mana_value };
}

const STREAM: DraftStream = {
  version: 1,
  draft: {
    id: 'sealed-c9',
    kind: 'sealed',
    event_name: 'Sealed_TRK_20261110',
    format_label: 'Sealed - TRK',
    started_at: '2026-11-11T22:10:00+00:00',
    updated_at: null,
    completed_at: '2026-11-11T23:19:00+00:00',
    record: { wins: 5, losses: 3, games: 8 },
  },
  picks: [],
  pool: [1, 2, 3, 99],
  deck: { name: 'Sealed Deck', submitted_at: null, main: [{ arena_id: 1, quantity: 1 }, { arena_id: 99, quantity: 16 }], sideboard: [{ arena_id: 2, quantity: 1 }, { arena_id: 3, quantity: 1 }] },
  cards: Object.fromEntries(
    [card(1, 'Captain', 'rare', 4), card(2, 'Ensign', 'common', 1), card(3, 'Tricorder', 'uncommon'), { ...card(99, 'Island', 'basic', 0), types: ['Land'] }].map((c) => [String(c.arena_id), c]),
  ),
};

describe('LimitedRunView', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 }))));
  afterEach(() => vi.unstubAllGlobals());

  it('shows the record, the pool with deck cards outlined, and the deck list', () => {
    render(<LimitedRunView stream={STREAM} returnHash={null} />);
    expect(screen.getByRole('heading', { name: /Sealed - TRK/ })).toBeInTheDocument();
    expect(screen.getByText('5–3')).toBeInTheDocument();
    const pool = screen.getByRole('region', { name: 'Pool' });
    expect(within(pool).getByText('3 cards')).toBeInTheDocument(); // basics left out
    expect(within(pool).getByRole('img', { name: 'Captain (rare)' }).closest('.draft-card')).toHaveClass('draft-card-indeck');
    expect(within(pool).getByRole('img', { name: 'Ensign (common)' }).closest('.draft-card')).toHaveClass('draft-card-cut');
    const deck = screen.getByRole('region', { name: 'Deck' });
    expect(within(deck).getByRole('region', { name: 'Deck (17)' })).toBeInTheDocument();
    expect(within(deck).getByRole('region', { name: 'Sideboard (2)' })).toBeInTheDocument();
  });
});
