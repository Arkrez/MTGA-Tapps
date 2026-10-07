import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';
import { fetchDashboardSnapshot } from './api';
import { parseDeckManagerRoute } from './routes';

vi.mock('./api', () => ({ fetchDashboardSnapshot: vi.fn() }));
vi.mock('./components/DeckManagerPage', () => ({ DeckManagerPage: () => <p>Saved deck library</p> }));

afterEach(() => { window.location.hash = ''; vi.unstubAllGlobals(); });

it('opens Deck Manager as a separate page without fetching overview history', async () => {
  window.location.hash = '#/deck-manager';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tracker: { state: 'idle' } }) }));
  render(<App />);
  expect(screen.getByText('Saved deck library')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Deck Manager' })).toBeInTheDocument();
  await waitFor(() => expect(document.title).toContain('Deck Manager'));
  expect(fetchDashboardSnapshot).not.toHaveBeenCalled();
});


it('recognizes collection section URLs after a reload', () => {
  expect(parseDeckManagerRoute('#deck-manager-import')).toBe(true);
  expect(parseDeckManagerRoute('#deck-manager-library')).toBe(true);
  expect(parseDeckManagerRoute('#overview')).toBe(false);
});
