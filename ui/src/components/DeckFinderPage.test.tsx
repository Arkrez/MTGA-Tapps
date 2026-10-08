import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchDeckFinderJob, fetchDeckFinderProviders, fetchDeckFinderSources,
  hydrateDeckFinderDeck, startDeckFinderFetch,
  type DeckFinderDeck, type DeckFinderJobStatus, type DeckFinderProvider, type DeckFinderView,
} from '../api';
import { importManagedDeck, addDeckToArena, fetchNativeDeckStatus, fetchNativeDeckJob } from '../deckManagerApi';
import { DeckFinderPage } from './DeckFinderPage';

vi.mock('../deckManagerApi', () => ({ importManagedDeck: vi.fn(), addDeckToArena: vi.fn(), fetchNativeDeckStatus: vi.fn(), fetchNativeDeckJob: vi.fn() }));

vi.mock('../api', () => ({
  fetchDeckFinderJob: vi.fn(), fetchDeckFinderProviders: vi.fn(),
  fetchDeckFinderSources: vi.fn(), hydrateDeckFinderDeck: vi.fn(),
  startDeckFinderFetch: vi.fn(), startDeckFinderSurprise: vi.fn(),
  startDeckFinderVariants: vi.fn(),
}));

const youtube: DeckFinderProvider = {
  key: 'youtube', display_name: 'youtube.com', description: 'Creators',
  homepage: 'https://www.youtube.com/', format_options: ['any'],
  uses_source_picker: true, allow_all_sources: false, source_picker_title: 'Creators',
  source_picker_all_label: 'all matching endpoints', creators: [],
};
const sources = [
  { name: 'Hello Good Game', url: 'https://www.youtube.com/@HelloGoodGame/videos', description: 'Latest 15 descriptions', formats: ['any'] },
  { name: 'Sloth', url: 'https://www.youtube.com/@SlothMtg/videos', description: 'Latest 15 descriptions', formats: ['any'] },
];
const view: DeckFinderView = {
  title: 'Creator Decks', count_label: 'Decks found', name_column_label: 'Deck',
  selection_label: 'Deck', selection_action: 'details', helper_text: null, show_notes: false,
  columns: [{ key: 'name', label: 'Deck' }, { key: 'player', label: 'Creator' }],
};
const deck: DeckFinderDeck = {
  name: 'Ramp 5 Lands at Once', source_site: 'youtube.com',
  source_url: 'https://www.youtube.com/watch?v=BfEESYLUBLQ', format_label: 'Standard',
  matches: null, win_rate: null, player_name: 'Hello Good Game', placing: null,
  event_name: null, event_date: null, notes: null,
  deck_text: 'About\nName Ramp 5 Lands at Once (HGG)\n\nDeck\n60 Forest',
  cells: { name: 'Ramp 5 Lands at Once', player: 'Hello Good Game' },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchDeckFinderProviders).mockResolvedValue([youtube]);
  vi.mocked(fetchDeckFinderSources).mockResolvedValue(sources);
  vi.mocked(startDeckFinderFetch).mockResolvedValue({ done: true, decks: [deck], view });
  vi.mocked(fetchNativeDeckStatus).mockResolvedValue({ available: false, connected: false, busy: false,
    decks: [], limit: null, limit_reached: null, deck_screen_open: false, message: '' });
});

async function chooseCreator(name = 'Hello Good Game') {
  fireEvent.click(await screen.findByRole('button', { name: /youtube\.com\s*Creators/ }));
  const creators = await screen.findByRole('group', { name: 'Creators' });
  fireEvent.click(within(creators).getByRole('button', { name }));
}

describe('YouTube Deck Finder', () => {
  it('opens the site picker without fetching sources or decks', async () => {
    const moxfield = {
      ...youtube, key: 'moxfield', display_name: 'moxfield.com',
      description: 'Full details about the public creator decks.',
    };
    vi.mocked(fetchDeckFinderProviders).mockResolvedValue([moxfield, youtube]);
    render(<DeckFinderPage />);
    const site = await screen.findByRole('button', { name: /moxfield\.com\s*Creators/ });
    expect(site).toHaveAttribute('title', moxfield.description);
    expect(screen.getByRole('button', { name: /youtube\.com\s*Creators/ })).toBeInTheDocument();
    expect(fetchDeckFinderSources).not.toHaveBeenCalled();
    expect(startDeckFinderFetch).not.toHaveBeenCalled();
  });

  it('fits the provider cards and shows only a Creators picker', async () => {
    render(<DeckFinderPage />);
    await chooseCreator('Sloth');
    expect(screen.queryByRole('group', { name: 'Match format' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /All \(/ })).not.toBeInTheDocument();
    expect(startDeckFinderFetch).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'youtube', format: 'any', source_name: 'Sloth', source_url: sources[1].url,
    }));
  });

  it('shows a simple loading message without a progress bar and exports without hydration', async () => {
    let finish!: (value: DeckFinderJobStatus) => void;
    vi.mocked(startDeckFinderFetch).mockResolvedValue({ job: 'youtube-job' });
    vi.mocked(fetchDeckFinderJob).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<DeckFinderPage />);
    await chooseCreator();
    expect(await screen.findByRole('status')).toHaveTextContent('Checking the latest 15 YouTube videos for decklists…');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await waitFor(() => expect(fetchDeckFinderJob).toHaveBeenCalled());
    await act(async () => { finish({ status: 'done', decks: [deck], view }); });
    fireEvent.click(await screen.findByRole('button', { name: deck.name }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy for Arena' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(deck.deck_text));
    expect(hydrateDeckFinderDeck).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute('href', deck.source_url);
  });

  it('retains the completed table during a YouTube refresh', async () => {
    render(<DeckFinderPage />);
    await chooseCreator();
    expect(await screen.findByRole('button', { name: deck.name })).toBeInTheDocument();
    vi.mocked(startDeckFinderFetch).mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(screen.getByRole('button', { name: deck.name })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Checking the latest 15 YouTube videos');
    expect(startDeckFinderFetch).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true }));
  });

  it('links to Settings when all YouTube creators are removed', async () => {
    vi.mocked(fetchDeckFinderSources).mockResolvedValue([]);
    render(<DeckFinderPage />);
    fireEvent.click(await screen.findByRole('button', { name: /youtube\.com\s*Creators/ }));
    expect(await screen.findByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/settings');
    expect(startDeckFinderFetch).not.toHaveBeenCalled();
  });

  it('does not replace a newly selected creator with an older completed job', async () => {
    let finish!: (value: DeckFinderJobStatus) => void;
    vi.mocked(startDeckFinderFetch).mockResolvedValueOnce({ job: 'old' });
    vi.mocked(fetchDeckFinderJob).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<DeckFinderPage />);
    await chooseCreator();
    await waitFor(() => expect(fetchDeckFinderJob).toHaveBeenCalled());
    const newer = { ...deck, name: 'Sloth Deck', source_url: 'https://www.youtube.com/watch?v=OVM43LPOhD4' };
    vi.mocked(startDeckFinderFetch).mockResolvedValue({ done: true, decks: [newer], view });
    fireEvent.click(within(screen.getByRole('group', { name: 'Creators' })).getByRole('button', { name: 'Sloth' }));
    expect(await screen.findByRole('button', { name: 'Sloth Deck' })).toBeInTheDocument();
    await act(async () => { finish({ status: 'done', decks: [deck], view }); });
    expect(screen.queryByRole('button', { name: deck.name })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sloth Deck' })).toBeInTheDocument();
  });
});


it('saves a selected Deck Finder list to the general library', async () => {
  vi.mocked(importManagedDeck).mockResolvedValue({ id: 'saved-id' } as Awaited<ReturnType<typeof importManagedDeck>>);
  render(<DeckFinderPage />);
  await chooseCreator();
  fireEvent.click(await screen.findByRole('button', { name: deck.name }));
  fireEvent.click(screen.getByRole('button', { name: 'Save to collection' }));
  await waitFor(() => expect(importManagedDeck).toHaveBeenCalledWith(deck.deck_text, deck.name, 'Standard'));
  expect(await screen.findByRole('link', { name: 'Open Deck Manager' })).toHaveAttribute('href', '#/deck-manager');
});

it('adds the chosen list directly to Arena once and monitors the result without clipboard use', async () => {
  vi.mocked(fetchNativeDeckStatus).mockResolvedValue({ available: true, connected: false, busy: false, decks: [], limit: null, limit_reached: null, deck_screen_open: false, message: '' });
  vi.mocked(addDeckToArena).mockResolvedValue({ job_id: 'native-import' });
  vi.mocked(fetchNativeDeckJob).mockResolvedValue({ state: 'done', detail: 'Completed.', result: { action: 'add', count: 1 } });
  render(<DeckFinderPage />);
  await chooseCreator();
  fireEvent.click(await screen.findByRole('button', { name: deck.name }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add to Arena' }));
  await waitFor(() => expect(addDeckToArena).toHaveBeenCalledExactlyOnceWith(deck.deck_text, deck.name, 'Standard'));
  expect(await screen.findByRole('status')).toHaveTextContent('Deck added to Arena');
  expect(screen.getByRole('button', { name: 'Added to Arena' })).toBeDisabled();
  expect(importManagedDeck).not.toHaveBeenCalled();
});

it.each([{ in_game: true }, { limit_reached: true }])('blocks direct adds while a game is active or slots are full', async (guard) => {
  vi.mocked(fetchNativeDeckStatus).mockResolvedValue({ available: true, connected: true, busy: false, decks: [], limit: 100, limit_reached: false, deck_screen_open: true, message: '', ...guard });
  render(<DeckFinderPage />);
  await chooseCreator();
  fireEvent.click(await screen.findByRole('button', { name: deck.name }));
  expect(await screen.findByRole('button', { name: 'Add to Arena' })).toBeDisabled();
  expect(addDeckToArena).not.toHaveBeenCalled();
});
