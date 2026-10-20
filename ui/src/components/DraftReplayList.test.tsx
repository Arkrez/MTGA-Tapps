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
};

describe('DraftReplayList', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  it('lists drafts and rescans the Arena logs on request', async () => {
    let drafts: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
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
    const table = await screen.findByRole('table', { name: 'Drafts to replay' });
    const row = within(table).getAllByRole('row')[1];
    expect(within(row).getByText('Fulminous Forte')).toBeInTheDocument();
    expect(within(row).getByText('Incomplete')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Replay draft' })).toHaveAttribute(
      'href',
      `#/replay/draft/bot-c1?return=${encodeURIComponent('#/replay')}`,
    );

    fireEvent.click(within(row).getByText('41'));
    expect(window.location.hash).toBe(`#/replay/draft/bot-c1?return=${encodeURIComponent('#/replay')}`);
  });
});
