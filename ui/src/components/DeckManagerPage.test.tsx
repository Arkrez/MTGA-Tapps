import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchDeckLibrary, fetchManagedDeck, importManagedDeck, updateManagedDeck, exportManagedDeck,
  type ManagedDeck, type ManagedDeckDetail,
} from '../deckManagerApi';
import { DeckManagerPage } from './DeckManagerPage';

vi.mock('../deckManagerApi', () => ({
  fetchDeckLibrary: vi.fn(), fetchManagedDeck: vi.fn(), importManagedDeck: vi.fn(),
  updateManagedDeck: vi.fn(), exportManagedDeck: vi.fn(), captureArenaDecks: vi.fn(),
}));

const saved: ManagedDeck = { id: 'deck-a', name: 'Any format deck', format_name: 'Standard',
  notes: '', tags: [], current_revision_id: 'new', trashed_at: null, saved_at: '2026-10-06T12:00:00Z', updated_at: '2026-10-06T12:00:00Z',
  source: 'import', completeness: 'text', main_count: 60, art_card: null };
const detail: ManagedDeckDetail = { ...saved, revision_id: 'new',
  deck: { name: saved.name, format_name: 'Standard', source: 'import', completeness: 'text',
    import_text: 'Deck\n4 Forest (DMU) 281', cards: [
      { section: 'Deck', quantity: 4, name: 'Forest', arena_id: null, set_code: 'DMU', collector_number: '281' },
      { section: 'Commander', quantity: 1, name: 'Atraxa', arena_id: null, set_code: null, collector_number: null },
    ] },
  revisions: [{ id: 'new', created_at: '2026-10-06T12:00:00Z', source: 'import', content_hash: 'new' },
    { id: 'old', created_at: '2026-10-01T12:00:00Z', source: 'import', content_hash: 'old' }],
};
const capabilities = { arena_transfers: false, native_section: false, capacity: null,
  message: 'Direct Arena transfers are not connected in this build.' };

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } },
  });
  vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [saved], capabilities });
  vi.mocked(fetchManagedDeck).mockResolvedValue(detail);
  vi.mocked(updateManagedDeck).mockResolvedValue({ ok: true });
  vi.mocked(importManagedDeck).mockResolvedValue(detail);
  vi.mocked(exportManagedDeck).mockResolvedValue({ text: 'Commander\n1 Atraxa\n\nDeck\n4 Forest (DMU) 281', name: saved.name, extension: '.txt' });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe('Deck Manager', () => {
  it('shows any deck and preserves the raw text and optional format on save', async () => {
    render(<DeckManagerPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add deck' }));
    expect(screen.getByRole('dialog', { name: 'Add a deck' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Deck name'), { target: { value: 'Another deck' } });
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'Historic Brawl' } });
    const text = 'Commander\n1 Atraxa\n\nDeck\n4 Forest (DMU) 281';
    fireEvent.change(screen.getByLabelText('Decklist or backup'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Save deck' }));
    await waitFor(() => expect(importManagedDeck).toHaveBeenCalledWith(text, 'Another deck', 'Historic Brawl', undefined));
  });

  it('copies the selected historical revision with its sections and printings', async () => {
    render(<DeckManagerPage />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(saved.name) }));
    await screen.findByRole('dialog', { name: saved.name });
    await screen.findByRole('button', { name: 'Copy for Arena' });
    vi.mocked(fetchManagedDeck).mockResolvedValue({ ...detail, revision_id: 'old' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Saved revision' }), { target: { value: 'old' } });
    await waitFor(() => expect(fetchManagedDeck).toHaveBeenLastCalledWith('deck-a', 'old', expect.any(AbortSignal)));
    const button = await screen.findByRole('button', { name: 'Copy for Arena' });
    fireEvent.click(button);
    await waitFor(() => expect(exportManagedDeck).toHaveBeenCalledWith('deck-a', 'old', 'arena'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Commander\n1 Atraxa\n\nDeck\n4 Forest (DMU) 281');
  });

  it('moves only the local archive to trash and offers restore', async () => {
    render(<DeckManagerPage />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(saved.name) }));
    await screen.findByRole('dialog', { name: saved.name });
    const trashed = { ...saved, trashed_at: '2026-10-06' };
    vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [trashed], capabilities });
    vi.mocked(fetchManagedDeck).mockResolvedValue({ ...detail, trashed_at: '2026-10-06' });
    fireEvent.click(await screen.findByRole('button', { name: 'Move to trash' }));
    await waitFor(() => expect(updateManagedDeck).toHaveBeenCalledWith('deck-a', { trashed: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Trash' }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(saved.name) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore from trash' }));
    await waitFor(() => expect(updateManagedDeck).toHaveBeenCalledWith('deck-a', { trashed: false }));
  });

  it('retains input when saving fails', async () => {
    vi.mocked(importManagedDeck).mockRejectedValue(new Error('Unrecognized card on line 2.'));
    render(<DeckManagerPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add deck' }));
    const text = 'Deck\ninvalid';
    fireEvent.change(screen.getByLabelText('Decklist or backup'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Save deck' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unrecognized card on line 2.');
    expect(screen.getByLabelText('Decklist or backup')).toHaveValue(text);
  });

  it('ignores a slow detail response after selecting a different deck', async () => {
    let finish!: (value: ManagedDeckDetail) => void;
    vi.mocked(fetchManagedDeck).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const other = { ...saved, id: 'deck-b', name: 'Second deck' };
    vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [saved, other], capabilities });
    vi.mocked(fetchManagedDeck).mockResolvedValue({ ...detail, ...other });
    render(<DeckManagerPage />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(saved.name) }));
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    fireEvent.click(screen.getByRole('button', { name: /Second deck/ }));
    await screen.findByRole('heading', { name: 'Second deck' });
    await act(async () => { finish(detail); });
    expect(screen.getByRole('heading', { name: 'Second deck' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: saved.name })).not.toBeInTheDocument();
  });
});


it('shows a large collection without opening or fetching details until a deck is clicked', async () => {
  vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: Array.from({ length: 104 }, (_, i) => ({ ...saved, id: `deck-${i}`, name: `Saved list ${i}` })), capabilities });
  render(<DeckManagerPage />);
  expect(await screen.findByRole('button', { name: 'Saved (104)' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Saved list/ })).toHaveLength(104);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(fetchManagedDeck).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search saved decks' }), { target: { value: 'Saved list 103' } });
  expect(screen.getAllByRole('button', { name: /Saved list/ })).toHaveLength(1);
});

it('closes on Escape and restores focus and scrolling to the collection', async () => {
  render(<DeckManagerPage />);
  const tile = await screen.findByRole('button', { name: new RegExp(saved.name) });
  tile.focus();
  fireEvent.click(tile);
  const dialog = await screen.findByRole('dialog', { name: saved.name });
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(tile).toHaveFocus();
  expect(document.body.style.overflow).toBe('');
});

it('edits a revision in a dialog bound to the opened deck', async () => {
  render(<DeckManagerPage />);
  const tile = await screen.findByRole('button', { name: new RegExp(saved.name) });
  tile.focus();
  fireEvent.click(tile);
  fireEvent.click(await screen.findByRole('button', { name: 'Save an edited revision…' }));
  expect(await screen.findByRole('dialog', { name: 'Save a new revision' })).toBeInTheDocument();
  const text = 'Deck\n5 Forest';
  fireEvent.change(screen.getByLabelText('Decklist or backup'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
  await waitFor(() => expect(importManagedDeck).toHaveBeenCalledWith(text, saved.name, 'Standard', saved.id));
  expect(await screen.findByRole('dialog', { name: saved.name })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(tile).toHaveFocus();
});
