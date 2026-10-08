import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchDeckFinderJob, fetchDeckFinderProviders, fetchDeckFinderSources,
  hydrateDeckFinderDeck, startDeckFinderFetch,
  type DeckFinderDeck, type DeckFinderJobStatus, type DeckFinderProvider, type DeckFinderView,
} from '../api';
import { DeckFinderPage } from './DeckFinderPage';

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
});

async function chooseCreator(name = 'Hello Good Game') {
  fireEvent.click(await screen.findByRole('button', { name: /youtube\.com\s*Creators/ }));
  const creators = await screen.findByRole('group', { name: 'Creators' });
  fireEvent.click(within(creators).getByRole('button', { name }));
}

describe('YouTube Deck Finder', () => {
  it('opens the first deck in the selected panel and keeps the browser available', async () => {
    const listed = { ...deck, deck_text: 'About\nName Ramp 5 Lands at Once (HGG)\n\nDeck\n4 Opt (STA) 19\n56 Island\nSideboard\n2 Negate (MOM) 68' };
    vi.mocked(startDeckFinderFetch).mockResolvedValue({ done: true, decks: [listed], view });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<DeckFinderPage />);
    await chooseCreator();
    const panel = await screen.findByRole('complementary', { name: 'Selected deck' });
    expect(within(panel).getByRole('heading', { name: 'Ramp 5 Lands at Once (HGG)' })).toBeInTheDocument();
    expect(within(panel).getByText('Hello Good Game · Standard · 60 cards')).toBeInTheDocument();
    expect(within(panel).queryByText('Selected deck')).not.toBeInTheDocument();
    expect(within(panel).queryByText(/card names/)).not.toBeInTheDocument();
    expect(within(panel).getByRole('list', { name: 'Deck cards' })).toHaveTextContent('4Opt56Island');
    expect(within(panel).getByRole('list', { name: 'Sideboard cards' })).toHaveTextContent('2Negate');
    expect(screen.getByRole('region', { name: 'Deck Finder results' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: deck.name })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(panel).getByRole('button', { name: 'Export to Arena' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(listed.deck_text?.replace('\nSideboard', '\n\nSideboard')));
  });

  it('keeps the new deck loading when an older creator hydration finishes', async () => {
    let finishOld!: (value: DeckFinderDeck) => void;
    let finishNew!: (value: DeckFinderDeck) => void;
    const old = { ...deck, deck_text: null };
    const newer = { ...deck, name: 'Sloth Brew', source_url: sources[1].url, deck_text: null };
    vi.mocked(startDeckFinderFetch).mockResolvedValueOnce({ done: true, decks: [old], view });
    vi.mocked(hydrateDeckFinderDeck)
      .mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { finishNew = resolve; }));
    render(<DeckFinderPage />);
    await chooseCreator();
    await waitFor(() => expect(hydrateDeckFinderDeck).toHaveBeenCalledTimes(1));
    vi.mocked(startDeckFinderFetch).mockResolvedValue({ done: true, decks: [newer], view });
    fireEvent.click(within(screen.getByRole('group', { name: 'Creators' })).getByRole('button', { name: 'Sloth' }));
    await waitFor(() => expect(hydrateDeckFinderDeck).toHaveBeenCalledTimes(2));
    await act(async () => { finishOld({ ...old, deck_text: 'Deck\n60 Forest' }); });
    const panel = screen.getByRole('complementary', { name: 'Selected deck' });
    expect(within(panel).getByRole('heading', { name: 'Sloth Brew' })).toBeInTheDocument();
    expect(within(panel).getByRole('status')).toHaveTextContent('Loading deck list');
    expect(within(panel).queryByText('Forest')).not.toBeInTheDocument();
    await act(async () => { finishNew({ ...newer, deck_text: 'Deck\n60 Island' }); });
    expect(within(panel).getByText('Island')).toBeInTheDocument();
    expect(within(panel).queryByRole('status')).not.toBeInTheDocument();
  });

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
    fireEvent.click(screen.getByRole('button', { name: 'Export to Arena' }));
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
