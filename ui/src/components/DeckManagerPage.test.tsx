import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchDeckLibrary, fetchManagedDeck, importManagedDeck, updateManagedDeck, exportManagedDeck, deleteManagedDeck, removeManagedDecks,
  saveDeckCollection, removeDeckCollection, moveDecksToCollection, fetchNativeDeckStatus, startNativeDeckJob, fetchNativeDeckJob,
  type ManagedDeck, type ManagedDeckDetail,
} from '../deckManagerApi';
import { DeckManagerPage } from './DeckManagerPage';

vi.mock('../deckManagerApi', () => ({
  saveDeckCollection: vi.fn(), removeDeckCollection: vi.fn(), moveDecksToCollection: vi.fn(), fetchDeckLibrary: vi.fn(), fetchManagedDeck: vi.fn(), importManagedDeck: vi.fn(),
  updateManagedDeck: vi.fn(), exportManagedDeck: vi.fn(), captureArenaDecks: vi.fn(), deleteManagedDeck: vi.fn(), removeManagedDecks: vi.fn(),
  fetchNativeDeckStatus: vi.fn(), startNativeDeckJob: vi.fn(), fetchNativeDeckJob: vi.fn(),
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

it('selects an imported deck using its full checkbox label without opening details', async () => {
  render(<DeckManagerPage />);
  const checkbox = await screen.findByRole('checkbox', { name: `Select ${saved.name}` });
  fireEvent.click(checkbox.closest('label')!);
  expect(checkbox).toBeChecked();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(fetchManagedDeck).not.toHaveBeenCalled();
});

it('lists every selected saved deck before a bulk move and preserves selection on cancellation', async () => {
  const other = { ...saved, id: 'deck-b', name: 'Second saved deck' };
  vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [saved, other], capabilities });
  render(<DeckManagerPage />);
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all visible saved decks' }));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: `Select ${other.name}` })).toBeChecked());
  fireEvent.click(screen.getByRole('button', { name: 'Move selected to trash' }));
  const dialog = screen.getByRole('dialog', { name: 'Move 2 decks to Trash?' });
  const list = within(dialog).getByRole('list', { name: 'Decks selected for removal' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  expect(list).toHaveTextContent(saved.name);
  expect(list).toHaveTextContent(other.name);
  expect(removeManagedDecks).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('checkbox', { name: `Select ${saved.name}` })).toBeChecked();
  expect(removeManagedDecks).not.toHaveBeenCalled();
});

it('moves only confirmed selected saved decks and prevents repeat removal', async () => {
  const other = { ...saved, id: 'deck-b', name: 'Second saved deck' };
  let finish!: (value: { ok: boolean; count: number }) => void;
  vi.mocked(removeManagedDecks).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [saved, other], capabilities });
  render(<DeckManagerPage />);
  fireEvent.click(await screen.findByRole('checkbox', { name: `Select ${saved.name}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Move selected to trash' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Move to trash' }));
  expect(removeManagedDecks).toHaveBeenCalledExactlyOnceWith([saved.id], 'trash');
  expect(screen.getByRole('button', { name: 'Moving…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [{ ...saved, trashed_at: 'today' }, other], capabilities });
  await act(async () => { finish({ ok: true, count: 1 }); });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('1 deck moved to Trash');
});

it('requires confirmation listing trashed decks for bulk permanent deletion and retains them on failure', async () => {
  const other = { ...saved, id: 'deck-b', name: 'Second saved deck', trashed_at: 'today' };
  vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [{ ...saved, trashed_at: 'today' }, other], capabilities });
  vi.mocked(removeManagedDecks).mockRejectedValue(new Error('Reconcile an interrupted transfer first.'));
  render(<DeckManagerPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Trash' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: `Select ${saved.name}` }));
  fireEvent.click(screen.getByRole('checkbox', { name: `Select ${other.name}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected permanently' }));
  const dialog = screen.getByRole('dialog', { name: 'Permanently delete 2 decks?' });
  expect(within(dialog).getByRole('list')).toHaveTextContent(other.name);
  expect(removeManagedDecks).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
  await waitFor(() => expect(removeManagedDecks).toHaveBeenCalledExactlyOnceWith([saved.id, other.id], 'delete'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Reconcile');
  expect(dialog).toBeInTheDocument();
  expect(fetchDeckLibrary).toHaveBeenCalledTimes(1);
});

it('selects decks already in Arena for local removal while rejecting a mixed restore selection', async () => {
  const active = { ...saved, native_restorable: true, native_arena_ids: ['arena-a'] };
  vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [active], capabilities });
  vi.mocked(fetchNativeDeckStatus).mockResolvedValue(connected);
  render(<DeckManagerPage />);
  fireEvent.click(await screen.findByRole('checkbox', { name: `Select ${saved.name}` }));
  expect(screen.getByRole('button', { name: 'Move selected to trash' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Restore selected to Arena' })).toBeDisabled();
});

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } },
  });
  vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [saved], capabilities });
  vi.mocked(fetchNativeDeckStatus).mockResolvedValue({ available: false, connected: false, busy: false, decks: [], limit: null, limit_reached: null, deck_screen_open: false, message: 'Open Arena to manage decks.' });
  vi.mocked(fetchManagedDeck).mockResolvedValue(detail);
  vi.mocked(updateManagedDeck).mockResolvedValue({ ok: true });
  vi.mocked(deleteManagedDeck).mockResolvedValue({ ok: true });
  vi.mocked(removeManagedDecks).mockResolvedValue({ ok: true, count: 2 });
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
    await waitFor(() => expect(importManagedDeck).toHaveBeenCalledWith(text, 'Another deck', 'Historic Brawl', undefined, null));
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
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).not.toBeInTheDocument();
    vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [trashed], capabilities });
    vi.mocked(fetchManagedDeck).mockResolvedValue({ ...detail, trashed_at: '2026-10-06' });
    fireEvent.click(await screen.findByRole('button', { name: 'Move to trash' }));
    expect(screen.getByRole('dialog', { name: `Move ${saved.name} to Trash?` })).toBeInTheDocument();
    expect(updateManagedDeck).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    await waitFor(() => expect(updateManagedDeck).toHaveBeenCalledWith('deck-a', { trashed: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Trash' }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(saved.name) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore from trash' }));
    await waitFor(() => expect(updateManagedDeck).toHaveBeenCalledWith('deck-a', { trashed: false }));
  });

  it('cancels a move to Trash without changing the deck or the selected revision', async () => {
    render(<DeckManagerPage />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(saved.name) }));
    await screen.findByRole('button', { name: 'Copy for Arena' });
    vi.mocked(fetchManagedDeck).mockResolvedValue({ ...detail, revision_id: 'old' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Saved revision' }), { target: { value: 'old' } });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Saved revision' })).toHaveValue('old'));
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    expect(screen.getByRole('dialog', { name: `Move ${saved.name} to Trash?` })).toHaveTextContent('You can restore it');
    expect(screen.queryByRole('button', { name: 'Copy for Arena' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('combobox', { name: 'Saved revision' })).toHaveValue('old');
    expect(updateManagedDeck).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));
    expect(screen.getByRole('dialog', { name: saved.name })).toBeInTheDocument();
    expect(updateManagedDeck).not.toHaveBeenCalled();
  });

  it('retains the deck when a confirmed move to Trash fails', async () => {
    vi.mocked(updateManagedDeck).mockRejectedValue(new Error('Unable to save the library.'));
    render(<DeckManagerPage />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(saved.name) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Move to trash' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save');
    expect(screen.getByRole('dialog', { name: `Move ${saved.name} to Trash?` })).toBeInTheDocument();
    expect(fetchDeckLibrary).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: saved.name })).toHaveTextContent('Forest');
  });

  it('requires confirmation before deleting a trashed deck and allows cancellation', async () => {
    vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [{ ...saved, trashed_at: '2026-10-06' }], capabilities });
    vi.mocked(fetchManagedDeck).mockResolvedValue({ ...detail, trashed_at: '2026-10-06' });
    render(<DeckManagerPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Trash' }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(saved.name) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete permanently' }));
    expect(screen.getByRole('dialog', { name: `Delete ${saved.name}?` })).toHaveTextContent('all 2 saved revisions');
    expect(deleteManagedDeck).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: saved.name })).toBeInTheDocument();
    expect(deleteManagedDeck).not.toHaveBeenCalled();
    expect(updateManagedDeck).not.toHaveBeenCalled();
  });

  it('deletes only the confirmed deck and prevents repeat actions while deleting', async () => {
    let finish!: (value: { ok: boolean }) => void;
    vi.mocked(deleteManagedDeck).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [{ ...saved, trashed_at: '2026-10-06' }], capabilities });
    vi.mocked(fetchManagedDeck).mockResolvedValue({ ...detail, trashed_at: '2026-10-06' });
    render(<DeckManagerPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Trash' }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(saved.name) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete permanently' }));
    vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [], capabilities });
    fireEvent.click(screen.getByRole('button', { name: 'Delete deck' }));
    expect(deleteManagedDeck).toHaveBeenCalledExactlyOnceWith(saved.id);
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    const dialog = screen.getByRole('dialog');
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => { finish({ ok: true }); });
    expect(await screen.findByText('No decks in trash.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('permanently deleted');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the confirmation and deck available when deletion fails', async () => {
    vi.mocked(deleteManagedDeck).mockRejectedValue(new Error('The deck library could not be saved.'));
    vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [{ ...saved, trashed_at: '2026-10-06' }], capabilities });
    vi.mocked(fetchManagedDeck).mockResolvedValue({ ...detail, trashed_at: '2026-10-06' });
    render(<DeckManagerPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Trash' }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(saved.name) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete permanently' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete deck' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    expect(screen.getByRole('dialog', { name: `Delete ${saved.name}?` })).toBeInTheDocument();
    expect(fetchDeckLibrary).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: saved.name })).toHaveTextContent('Forest');
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
  await waitFor(() => expect(importManagedDeck).toHaveBeenCalledWith(text, saved.name, 'Standard', saved.id, undefined));
  expect(await screen.findByRole('dialog', { name: saved.name })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(tile).toHaveFocus();
});

const connected = { available: true, connected: true, busy: false, deck_screen_open: true,
  limit: 100, limit_reached: false, message: 'Arena ready.', refreshed_at: '2026-10-07T12:00:00Z',
  decks: [{ id: 'arena-a', name: 'Arena fixture A', format_name: 'Standard', main_count: 60 },
    { id: 'arena-b', name: 'Arena fixture B', format_name: 'Brawl', main_count: 100 }], pending_transfers: [] };

it('reads native status without automatically starting an Arena job', async () => {
  vi.mocked(fetchNativeDeckStatus).mockResolvedValue(connected);
  render(<DeckManagerPage />);
  expect(await screen.findByRole('button', { name: 'Arena (2)' })).toBeInTheDocument();
  expect(startNativeDeckJob).not.toHaveBeenCalled();
});

it('requires confirmation for bulk moves and cancellation never starts a job', async () => {
  vi.mocked(fetchNativeDeckStatus).mockResolvedValue(connected);
  render(<DeckManagerPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Arena (2)' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all visible Arena decks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Move to collection' }));
  const dialog = screen.getByRole('dialog', { name: 'Move 2 decks to your collection?' });
  expect(dialog).toHaveTextContent('backed up and checked before');
  expect(dialog).toHaveTextContent('Arena fixture A');
  expect(dialog).toHaveTextContent('Arena fixture B');
  expect(startNativeDeckJob).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(startNativeDeckJob).not.toHaveBeenCalled();
  expect(screen.getByRole('checkbox', { name: 'Select Arena fixture A' })).toBeChecked();
});

it('moves only the confirmed selected Arena decks and monitors the job', async () => {
  vi.mocked(fetchNativeDeckStatus).mockResolvedValue(connected);
  vi.mocked(startNativeDeckJob).mockResolvedValue({ job_id: 'move-job' });
  vi.mocked(fetchNativeDeckJob).mockResolvedValue({ state: 'done', detail: 'Completed.', result: { action: 'store', count: 1 } });
  render(<DeckManagerPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Arena (2)' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Arena fixture A' }));
  fireEvent.click(screen.getByRole('button', { name: 'Move to collection' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Move to collection' }));
  await waitFor(() => expect(startNativeDeckJob).toHaveBeenCalledExactlyOnceWith('store', [{ id: 'arena-a' }]));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Moved 1 deck'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('restores the selected native revision directly without copying', async () => {
  vi.mocked(fetchNativeDeckStatus).mockResolvedValue(connected);
  vi.mocked(fetchManagedDeck).mockResolvedValue({ ...detail, native_restorable: true });
  vi.mocked(startNativeDeckJob).mockResolvedValue({ job_id: 'restore-job' });
  vi.mocked(fetchNativeDeckJob).mockResolvedValue({ state: 'done', detail: 'Completed.', result: { action: 'restore', count: 1 } });
  render(<DeckManagerPage />);
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(saved.name) }));
  fireEvent.click(await screen.findByRole('button', { name: 'Restore to Arena' }));
  await waitFor(() => expect(startNativeDeckJob).toHaveBeenCalledExactlyOnceWith('restore', [{ id: saved.id, revision: 'new' }]));
  expect(exportManagedDeck).not.toHaveBeenCalled();
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
});

it('disables native restore when slots are full and offers reconciliation for interruptions', async () => {
  vi.mocked(fetchNativeDeckStatus).mockResolvedValue({ ...connected, limit_reached: true,
    pending_transfers: [{ id: 'pending', action: 'restore', phase: 'uncertain', deck_id: saved.id }] });
  vi.mocked(fetchManagedDeck).mockResolvedValue({ ...detail, native_restorable: true });
  render(<DeckManagerPage />);
  expect(await screen.findByRole('button', { name: 'Reconcile transfers' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: new RegExp(saved.name) }));
  expect(await screen.findByRole('button', { name: 'Restore to Arena' })).toBeDisabled();
  expect(startNativeDeckJob).not.toHaveBeenCalled();
});

it('uses the saved artwork for matching Arena tiles and filters their backup status', async () => {
  vi.mocked(fetchNativeDeckStatus).mockResolvedValue(connected);
  vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [{ ...saved, native_restorable: true, native_arena_ids: ['arena-a'], art_card: 'Forest' }], capabilities });
  render(<DeckManagerPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Arena (2)' }));
  const image = await screen.findByRole('img', { name: 'Forest' });
  expect(image).toHaveAttribute('src', expect.stringContaining('named?exact=Forest'));
  fireEvent.click(screen.getByRole('button', { name: 'Filter by Not backed up' }));
  expect(screen.getByRole('combobox', { name: 'Filter decks by status' })).toHaveValue('unbacked');
  expect(screen.queryByRole('checkbox', { name: 'Select Arena fixture A' })).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Select Arena fixture B' })).toBeInTheDocument();
});

it('filters saved presence and backup type through pills and clears hidden selection', async () => {
  const second = { ...saved, id: 'second', name: 'Collection deck', native_restorable: true };
  vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [{ ...saved, native_arena_ids: ['arena-a'] }, second], capabilities });
  vi.mocked(fetchNativeDeckStatus).mockResolvedValue(connected);
  render(<DeckManagerPage />);
  fireEvent.click(await screen.findByRole('checkbox', { name: `Select ${saved.name}` }));
  fireEvent.click(await screen.findByRole('button', { name: 'Filter by Collection only' }));
  expect(screen.queryByRole('checkbox', { name: `Select ${saved.name}` })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Move selected to trash' })).toBeDisabled();
  expect(fetchManagedDeck).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter decks by status' }), { target: { value: 'text' } });
  expect(screen.getByRole('checkbox', { name: `Select ${saved.name}` })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: `Select ${second.name}` })).not.toBeInTheDocument();
});

it('creates collections, collapses their decks and moves a selection to another collection', async () => {
  const collection = { id: 'group-a', name: 'Control' };
  vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [{ ...saved, collection_id: collection.id }], collections: [collection], capabilities });
  vi.mocked(saveDeckCollection).mockResolvedValue({ id: 'group-b', name: 'Brawl' });
  vi.mocked(moveDecksToCollection).mockResolvedValue({ ok: true, count: 1 });
  render(<DeckManagerPage />);
  const group = await screen.findByRole('region', { name: 'Control collection' });
  const toggle = within(group).getByRole('button', { name: 'Control (1)' });
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('checkbox', { name: `Select ${saved.name}` })).not.toBeInTheDocument();
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('checkbox', { name: `Select ${saved.name}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Move decks' }));
  await waitFor(() => expect(moveDecksToCollection).toHaveBeenCalledExactlyOnceWith([saved.id], null));
  fireEvent.click(screen.getByRole('button', { name: 'New collection' }));
  fireEvent.change(screen.getByLabelText('Collection name'), { target: { value: 'Brawl' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create collection' }));
  await waitFor(() => expect(saveDeckCollection).toHaveBeenCalledExactlyOnceWith('Brawl', undefined));
});

it('requires confirmation to remove a collection and explains that decks are retained', async () => {
  const collection = { id: 'group-a', name: 'Control' };
  vi.mocked(fetchDeckLibrary).mockResolvedValue({ decks: [{ ...saved, collection_id: collection.id }], collections: [collection], capabilities });
  vi.mocked(removeDeckCollection).mockResolvedValue({ ok: true, count: 1 });
  render(<DeckManagerPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Remove Control collection' }));
  const dialog = screen.getByRole('dialog', { name: 'Remove Control collection?' });
  expect(dialog).toHaveTextContent('Unsorted');
  expect(dialog).toHaveTextContent('saved revisions will be retained');
  expect(removeDeckCollection).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove collection' }));
  await waitFor(() => expect(removeDeckCollection).toHaveBeenCalledExactlyOnceWith(collection.id));
});

it('shows verified transfer progress and leaves connecting progress indeterminate', async () => {
  vi.mocked(fetchNativeDeckStatus).mockResolvedValue({ ...connected, active_job: 'running-job', busy: true });
  vi.mocked(fetchNativeDeckJob).mockResolvedValue({ state: 'running', detail: 'Verified 1 of 4 transfers…', progress: { completed: 1, total: 4 } });
  render(<DeckManagerPage />);
  const bar = await screen.findByRole('progressbar', { name: 'Deck transfer progress' });
  expect(bar).toHaveAttribute('max', '4');
  expect(bar).toHaveAttribute('value', '1');
  expect(screen.getByText('25%')).toBeInTheDocument();
});
