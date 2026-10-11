import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSampleStream } from '../fixtures/sampleStream';
import { PlaybackClock } from '../player';
import { PREFS_STORAGE_KEY } from '../prefs';
import ReplayPage from './ReplayPage';
import { STACK_EXIT_MS } from './StackPreview';

// No WebGL under jsdom: the canvas becomes a plain div and R3F hooks are inert.
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ className }: { className?: string; children?: ReactNode }) => (
    <div className={className} data-testid="replay-canvas" />
  ),
  useFrame: () => undefined,
  useThree: () => undefined,
}));

const stream = makeSampleStream();
const total = stream.events.length;
// Playback opens at the first turn header, the opening hands already dealt; the
// opening deal before it is not navigable, so the counter counts from there.
const START = stream.events.findIndex((e) => e.kind === 'turn');
const nav = total - START;
const rel = (index: number) => `Event ${index - START + 1} / ${nav}`;
const at = (offset: number) => rel(START + offset);
const last = `Event ${nav} / ${nav}`;

function stubFetch(response: () => Response) {
  const fetchMock = vi.fn(async (url: string) =>
    String(url).startsWith('/api/replay') ? response() : new Response('', { status: 404 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function counter() {
  return screen.getByText(/^Event \d+ \/ \d+$/).textContent;
}

async function renderPage(props: { at?: number | null; row?: number | null; returnHash?: string | null } = {}) {
  render(<ReplayPage gameId="game-1" at={props.at ?? null} row={props.row ?? null} returnHash={props.returnHash ?? null} />);
  await screen.findByRole('slider', { name: 'Replay position' });
}

describe('ReplayPage', () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = '#/replay/game-1';
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    // No real contexts under jsdom: a stub for WebGL (the probe passes), none for 2D.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
      type === 'webgl2' || type === 'webgl' ? ({} as unknown as RenderingContext) : null) as typeof HTMLCanvasElement.prototype.getContext);
    stubFetch(() => new Response(JSON.stringify(stream), { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows loading, then the HUD, table, log and controls', async () => {
    render(<ReplayPage gameId="game-1" at={null} returnHash={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading replay');
    await screen.findByRole('slider', { name: 'Replay position' });
    expect(fetch).toHaveBeenCalledWith('/api/replay?id=game-1', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByTestId('replay-canvas')).toBeInTheDocument();
    expect(screen.getByLabelText('Game state')).toHaveTextContent('Turn 1');
    expect(screen.getByRole('list', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Play/ })).toBeInTheDocument();
    expect(counter()).toBe(at(0));
    expect(screen.getByText('Recorded')).toHaveAttribute('title', expect.stringContaining('full detail'));
    expect(document.title).toBe('Tapps Tracker – Replay');
  });

  it('restores the document title on unmount', async () => {
    document.title = 'Before';
    const { unmount } = render(<ReplayPage gameId="game-1" at={null} returnHash={null} />);
    expect(document.title).toBe('Tapps Tracker – Replay');
    unmount();
    expect(document.title).toBe('Before');
  });

  it('seeks to the ?at= deep link on load', async () => {
    const turn3 = stream.turns.find((t) => t.turn === 3)!;
    await renderPage({ at: turn3.first_seq });
    const index = stream.events.findIndex((e) => e.seq === turn3.first_seq);
    expect(counter()).toBe(rel(index));
    expect(screen.getByLabelText('Game state')).toHaveTextContent('Turn 3');
  });

  it('opens a ?row= deep link at the first event derived from that game_events row', async () => {
    // Several events can share one row; the viewer opens at the first of them.
    const tagged = { ...stream, events: stream.events.map((event, i) => ({ ...event, row_id: 500 + Math.floor(i / 3) })) };
    stubFetch(() => new Response(JSON.stringify(tagged), { status: 200 }));
    const rowIndex = Math.floor((START + 4) / 3);
    await renderPage({ row: 500 + rowIndex });
    expect(counter()).toBe(rel(rowIndex * 3));
  });

  it('prefers ?at= over ?row= and falls back to the start for an unknown row', async () => {
    const tagged = { ...stream, events: stream.events.map((event, i) => ({ ...event, row_id: 500 + i })) };
    stubFetch(() => new Response(JSON.stringify(tagged), { status: 200 }));
    const { unmount } = render(<ReplayPage gameId="game-1" at={stream.events[START + 2].seq} row={507} returnHash={null} />);
    await screen.findByRole('slider', { name: 'Replay position' });
    expect(counter()).toBe(at(2));
    unmount();
    await renderPage({ row: 99999 });
    expect(counter()).toBe(at(0));
  });

  it('renders the unavailable reason with a back link', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: 'replay_unavailable', reason: 'no events' }), { status: 404 }));
    render(<ReplayPage gameId="game-1" at={null} returnHash="#/game?id=game-1" />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This game has no replay.');
    expect(alert).toHaveTextContent('Reason: no events.');
    expect(within(alert).getByRole('link', { name: /Back/ })).toHaveAttribute('href', '#/game?id=game-1');
  });

  it('labels reconstructed streams with their limitations and disables hindsight', async () => {
    const reconstructed = { ...stream, fidelity: 'reconstructed', limitations: ['Blocks are inferred.'] };
    stubFetch(() => new Response(JSON.stringify(reconstructed), { status: 200 }));
    await renderPage();
    expect(screen.getByText('Reconstructed')).toHaveAttribute('title', expect.stringContaining('Blocks are inferred.'));
    fireEvent.click(screen.getByRole('button', { name: 'Replay Options' }));
    expect(screen.getByRole('checkbox', { name: /Hindsight/ })).toBeDisabled();
  });

  it('renders an error for an unknown game', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));
    render(<ReplayPage gameId="nope" at={null} returnHash={null} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the replay.');
    expect(within(alert).getByRole('link', { name: /Back/ })).toHaveAttribute('href', '#/replay');
  });

  it('moves the clock with keyboard shortcuts and ignores them while typing', async () => {
    await renderPage();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(counter()).toBe(at(2));
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(counter()).toBe(at(1));
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getByLabelText('Game state')).toHaveTextContent('Turn 2');
    fireEvent.keyDown(window, { key: 'K' });
    expect(screen.getByLabelText('Game state')).toHaveTextContent('Turn 3');
    fireEvent.keyDown(window, { key: 'End' });
    expect(counter()).toBe(last);
    // Home is turn 1: nothing before it is navigable.
    fireEvent.keyDown(window, { key: 'Home' });
    expect(counter()).toBe(at(0));
    expect(screen.getByLabelText('Game state')).toHaveTextContent('Turn 1');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(counter()).toBe(at(0));

    fireEvent.keyDown(window, { key: ']' });
    expect(screen.getByRole('combobox')).toHaveValue('2');
    fireEvent.keyDown(window, { key: '[' });
    expect(screen.getByRole('combobox')).toHaveValue('1');

    fireEvent.keyDown(window, { key: 'g' });
    const goTo = screen.getByPlaceholderText('Go to turn…');
    expect(goTo).toHaveFocus();
    fireEvent.keyDown(goTo, { key: 'ArrowRight' });
    expect(counter()).toBe(at(0));
    fireEvent.change(goTo, { target: { value: '4' } });
    fireEvent.submit(goTo.closest('form')!);
    expect(screen.getByLabelText('Game state')).toHaveTextContent('Turn 4');

    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByRole('button', { name: /Pause/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByRole('button', { name: /Play/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the ending screen at the last event and clears it when scrubbing back', async () => {
    await renderPage();
    expect(screen.queryByRole('dialog', { name: 'Game result' })).toBeNull();
    fireEvent.keyDown(window, { key: 'End' });
    const result = screen.getByRole('dialog', { name: 'Game result' });
    expect(result).toHaveClass('replay-end-win');
    expect(within(result).getByRole('heading')).toHaveTextContent('Victory');
    expect(result).toHaveTextContent('Opponent conceded');
    expect(within(result).getByLabelText('Final life totals')).toHaveTextContent('18');
    expect(screen.getByLabelText('Game state')).toHaveTextContent('Victory');

    fireEvent.click(within(result).getByRole('button', { name: 'Show table' }));
    expect(screen.queryByRole('dialog', { name: 'Game result' })).toBeNull();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'End' });
    expect(screen.getByRole('dialog', { name: 'Game result' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Watch again' }));
    expect(screen.queryByRole('dialog', { name: 'Game result' })).toBeNull();
    expect(counter()).toBe(at(0));
    expect(screen.getByRole('button', { name: /Pause/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: ' ' });
  });

  it('seeks when a log row is clicked and highlights it', async () => {
    await renderPage();
    const log = screen.getByRole('list', { name: 'Actions' });
    const row = within(log).getByText('Opponent passes').closest('li')!;
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-current', 'step');
    const note = stream.events.find((e) => e.kind === 'note' && e.log?.text === 'Opponent passes')!;
    expect(counter()).toBe(rel(stream.events.indexOf(note)));
  });

  it('writes the position into the hash while paused, without new history entries', async () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    const push = vi.spyOn(window.history, 'pushState');
    await renderPage({ returnHash: '#/games' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(replace).toHaveBeenCalled(), { timeout: 1500 });
    const url = String(replace.mock.calls.at(-1)?.[2]);
    expect(url).toContain(`at=${stream.events[START + 1].seq}`);
    expect(url).toContain('return=%23%2Fgames');
    expect(push).not.toHaveBeenCalled();
  });

  it('never rewrites the hash during playback, and debounces it once paused', async () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    await renderPage();
    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: ' ' });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(counter()).not.toBe(at(0));
    expect(replace).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: ' ' });
    // Rapid steps while paused collapse into one write after the debounce.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(replace).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('persists Replay Options choices', async () => {
    await renderPage();
    expect(screen.queryByRole('button', { name: 'Table' })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 't' });
    const dialog = screen.getByRole('dialog', { name: 'Replay Options' });
    expect(within(dialog).getByRole('heading', { name: 'Replay Options' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Felt: Blue' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Opponent sleeves: Gold' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Top-down' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Mirror opponent/ }));
    const saved = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) ?? '{}');
    expect(saved).toMatchObject({ felt: 'blue', opponentSleeve: 'gold', camera: 'topdown', mirrorOpponent: true });
    expect(within(dialog).getByRole('button', { name: 'Felt: Blue' })).toHaveAttribute('aria-pressed', 'true');
    // Recorded streams support hindsight (on by default).
    const hindsight = within(dialog).getByRole('checkbox', { name: /Hindsight/ });
    expect(hindsight).toBeChecked();
    fireEvent.click(hindsight);
    expect(JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) ?? '{}').hindsight).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('collapses the Actions panel to a rail and remembers it', async () => {
    const { unmount } = render(<ReplayPage gameId="game-1" at={null} returnHash={null} />);
    await screen.findByRole('slider', { name: 'Replay position' });
    const panel = screen.getByRole('complementary', { name: 'Action log' });
    const hide = within(panel).getByRole('button', { name: 'Hide actions' });
    // Same control as the sidebar's: the « » glyph pair, mirrored for a right-hand panel.
    expect(hide).toHaveTextContent('\u00bb');
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(hide);
    expect(screen.queryByRole('list', { name: 'Actions' })).not.toBeInTheDocument();
    expect(panel).toHaveClass('replay-log-collapsed');
    expect(panel.closest('.replay-body')).toHaveClass('replay-body-log-collapsed');
    const show = within(panel).getByRole('button', { name: 'Show actions' });
    expect(show).toHaveTextContent('\u00ab');
    expect(JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) ?? '{}').logCollapsed).toBe(true);
    unmount();

    // A new visit opens collapsed; expanding brings the log back.
    await renderPage();
    const again = screen.getByRole('complementary', { name: 'Action log' });
    expect(again).toHaveClass('replay-log-collapsed');
    fireEvent.click(within(again).getByRole('button', { name: 'Show actions' }));
    expect(screen.getByRole('list', { name: 'Actions' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) ?? '{}').logCollapsed).toBe(false);
  });

  it('previews the stack as large cards, top first, with targeting arrows', async () => {
    const push = stream.events.find((e) => e.kind === 'stack_push' && e.stack_id === 's2')!;
    await renderPage({ at: push.seq });
    const list = screen.getByRole('list', { name: 'Stack' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('data-stack-id'))).toEqual(['s2', 's1']);
    expect(items[0]).toHaveClass('replay-stack-full', 'replay-stack-opp', 'replay-stack-top');
    expect(items[0]).toHaveTextContent('Negate');
    expect(items[0]).toHaveTextContent('Opponent · Spell · resolves next');
    expect(items[1]).toHaveTextContent('Llanowar Elves');
    expect(items[1]).toHaveClass('replay-stack-you', 'replay-stack-targeted');
    // Negate counters the Elves: one arrow from its card to the Elves' card.
    const arrows = document.querySelectorAll('.replay-arrows [data-arrow]');
    expect([...arrows].map((a) => a.getAttribute('data-arrow'))).toEqual(['target:s2:212']);
    expect(arrows[0]).toHaveClass('replay-arrow-target');
    expect((arrows[0] as SVGGElement).style.getPropertyValue('--arrow-glow')).toMatch(/^hsl\(/);
    // Only the cards take pointer events: the layer itself is click-through (CSS), cards open the card page.
    fireEvent.click(items[0]);
    expect(window.location.hash).toMatch(/^#\/card\//);
  });

  it('holds a resolved item with its stamp while paused, until the next step', async () => {
    const trigger = stream.events.find((e) => e.kind === 'stack_push' && e.stack_id === 's5')!;
    await renderPage({ at: trigger.seq });
    expect(within(screen.getByRole('list', { name: 'Stack' })).getAllByRole('listitem')).toHaveLength(1);
    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.queryByRole('list', { name: 'Stack' })).toBeInTheDocument();
    const leaving = () => document.querySelector('.replay-stack-exits .replay-stack-leaving[data-stack-id="s5"]');
    expect(leaving()).toHaveClass('replay-stack-resolved');
    expect(leaving()).toHaveTextContent('Resolved');
    expect(document.querySelector('.replay-stack-preview')).toHaveClass('replay-stack-held');
    expect(within(screen.getByRole('list', { name: 'Stack' })).queryAllByRole('listitem')).toHaveLength(0);
    // Paused: the stamped card outlasts the exit animation.
    act(() => {
      vi.advanceTimersByTime(STACK_EXIT_MS * 3);
    });
    expect(leaving()).toHaveTextContent('Resolved');
    // The next step changes the board: the held item goes.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(leaving()).toBeNull();
    // Seeking never animates: jumping onto a stack shows it at once, with no exits.
    fireEvent.keyDown(window, { key: 'Home' });
    expect(document.querySelector('.replay-stack-exits')).toBeNull();
  });

  it('drops a held item once play resumes, after the exit animation', async () => {
    const trigger = stream.events.find((e) => e.kind === 'stack_push' && e.stack_id === 's5')!;
    await renderPage({ at: trigger.seq });
    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const leaving = () => document.querySelector('.replay-stack-exits .replay-stack-leaving[data-stack-id="s5"]');
    expect(leaving()).toHaveTextContent('Resolved');
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByRole('button', { name: /Pause/ })).toBeInTheDocument();
    // Playing again: the exit animation runs and the item is dropped after it.
    expect(document.querySelector('.replay-stack-held')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(STACK_EXIT_MS);
    });
    expect(leaving()).toBeNull();
  });

  it('flashes a resolving item on its way out during playback and drops it after the animation', async () => {
    const trigger = stream.events.find((e) => e.kind === 'stack_push' && e.stack_id === 's5')!;
    await renderPage({ at: trigger.seq });
    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByRole('button', { name: /Pause/ })).toBeInTheDocument();
    const leaving = () => document.querySelector('.replay-stack-exits .replay-stack-leaving[data-stack-id="s5"]');
    // The clock holds each event for at least 600 ms, longer than the exit animation.
    for (let waited = 0; !leaving() && waited < 5000; waited += 50) {
      act(() => {
        vi.advanceTimersByTime(50);
      });
    }
    expect(leaving()).toHaveClass('replay-stack-resolved');
    expect(document.querySelector('.replay-stack-held')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(STACK_EXIT_MS);
    });
    expect(leaving()).toBeNull();
  });

  it('shows a notice instead of the canvas below 900 px but keeps the log', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    await renderPage();
    expect(screen.queryByTestId('replay-canvas')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('at least 900 px wide');
    expect(screen.getByRole('list', { name: 'Actions' })).toBeInTheDocument();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('replay-canvas')).toBeInTheDocument();
  });

  it('explains when the browser has no WebGL instead of leaving the table blank', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await renderPage();
    expect(screen.queryByTestId('replay-canvas')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('needs WebGL');
    expect(screen.getByRole('list', { name: 'Actions' })).toBeInTheDocument();
  });

  it('opens the video export dialog, which says when the browser cannot encode video', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Export video' }));
    const dialog = screen.getByRole('dialog', { name: 'Export video' });
    // jsdom has no WebCodecs: the dialog explains instead of offering options.
    expect(dialog).toHaveTextContent(/cannot encode video/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Export video' })).not.toBeInTheDocument();
  });

  it('cleans up the clock, timers and listeners when navigating replay -> overview -> replay', async () => {
    const dispose = vi.spyOn(PlaybackClock.prototype, 'dispose');
    const added: Array<[string, unknown]> = [];
    const removed: Array<[string, unknown]> = [];
    const realAdd = window.addEventListener.bind(window);
    const realRemove = window.removeEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      added.push([type, listener]);
      realAdd(type, listener, options);
    });
    vi.spyOn(window, 'removeEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
      removed.push([type, listener]);
      realRemove(type, listener, options);
    });

    function Harness({ page }: { page: 'replay' | 'overview' }) {
      return page === 'replay' ? <ReplayPage gameId="game-1" at={null} returnHash={null} /> : <p>Overview</p>;
    }
    const { rerender } = render(<Harness page="replay" />);
    await screen.findByRole('slider', { name: 'Replay position' });
    // Leave while playing: the pending playback timer must not survive.
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByRole('button', { name: /Pause/ })).toBeInTheDocument();

    rerender(<Harness page="overview" />);
    await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
    const first = dispose.mock.contexts[0] as PlaybackClock;
    expect(first.isPlaying).toBe(false);
    expect(first.isDisposed).toBe(true);
    expect(first.listenerCount).toBe(0);
    // Every window listener the page added is gone (keyboard, resize, storage).
    for (const [type, listener] of added) {
      expect(removed.some(([t, l]) => t === type && l === listener)).toBe(true);
    }
    // A disposed clock ignores further commands instead of scheduling timers.
    first.play();
    expect(first.isPlaying).toBe(false);

    added.length = 0;
    removed.length = 0;
    rerender(<Harness page="replay" />);
    await screen.findByRole('slider', { name: 'Replay position' });
    expect(counter()).toBe(at(0));
    // The new page's shortcuts drive only the new clock.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(counter()).toBe(at(1));
    expect(added.filter(([type]) => type === 'keydown')).toHaveLength(1);
  });
});
