/**
 * The loaded Draft Replay: the pack in front of the player (rarest first,
 * the pick highlighted, a 17lands win-rate heat map behind each card), a
 * "seen before" banner and the cards missing since then when the pack
 * wheeled, the pool as it is assembled (Arena's mana-value columns, cards
 * that made the final deck marked), a larger copy of a card after a short
 * hover, and the framework transport bar. `?step=` keeps the position
 * shareable.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Badge } from '../../components/Badge';
import { ColorPips } from '../../components/ColorPips';
import { formatDateTime } from '../../format';
import { REPLAY_ROUTE_HASH, draftReplayRouteHash, parseDraftReplayRoute } from '../../routes';
import { StepControls } from '../framework/StepControls';
import { indexOfKey } from '../framework/timeline';
import { useStepKeyboard, useStepPlayback } from '../framework/useStepPlayback';
import { DraftCardImage } from './DraftCardImage';
import { FinalDeckDialog } from './FinalDeckDialog';
import { preloadImages, useDraftImages, type DraftImages } from './draftImages';
import {
  POOL_COLUMNS,
  buildDraftSteps,
  byRarity,
  cardFor,
  compareByRarity,
  inDeckFlags,
  mainDeckCounts,
  poolColumn,
  summarizePool,
  type DraftStep,
  type PoolColumn,
} from './model';
import { formatWinRate, heatColor, useSeventeenLandsRatings, type Ratings } from './seventeenLands';
import type { DraftStream } from './types';

const HASH_DEBOUNCE_MS = 300;
/** Arena enlarges a hovered card after a short pause; this matches its feel. */
export const HOVER_PREVIEW_MS = 450;
const WIN_RATES_KEY = 'tapps.draftReplay.winRates';

function readWinRatesPref(): boolean {
  try {
    return localStorage.getItem(WIN_RATES_KEY) !== 'off';
  } catch {
    return true;
  }
}

interface DraftReplayViewerProps {
  stream: DraftStream;
  step: string | null;
  returnHash: string | null;
}

interface HoverPreview {
  arenaId: number;
  /** Step it was opened on: stepping away hides it. */
  index: number;
  left: number;
  top: number;
}

function SeenBanner({ step, steps }: { step: DraftStep; steps: DraftStep[] }) {
  if (!step.packCards.length) {
    return <p className="draft-seen draft-seen-unknown">The tracker did not see this pack — only the pick was recorded.</p>;
  }
  if (step.seenAt === null) {
    return (
      <p className="draft-seen draft-seen-new">
        <span className="draft-seen-dot" aria-hidden="true" /> First look at this pack
      </p>
    );
  }
  const gap = step.pick - (step.seenPick ?? step.pick);
  const earlier = steps[step.seenAt];
  return (
    <p className="draft-seen draft-seen-wheel">
      <span className="draft-seen-dot" aria-hidden="true" />
      <strong>Seen before</strong> — this pack wheeled from Pick {earlier.pick} ({gap} picks ago).{' '}
      {step.missing.length} card{step.missing.length === 1 ? '' : 's'} left it since.
    </p>
  );
}

function RatingChip({ arenaId, ratings }: { arenaId: number; ratings: Ratings | null }) {
  const rating = ratings?.byArenaId.get(arenaId);
  if (!ratings || rating?.gihWr == null) return null;
  return (
    <span className="draft-wr-chip" title={`17lands GIH win rate (${rating.games.toLocaleString()} games)`}>
      {formatWinRate(rating.gihWr)}
    </span>
  );
}

function heatStyle(arenaId: number, ratings: Ratings | null) {
  const rate = ratings?.byArenaId.get(arenaId)?.gihWr;
  if (!ratings || rate == null) return undefined;
  return { ['--draft-heat' as string]: heatColor(rate, ratings.mean, ratings.spread) };
}

function largeUrl(url: string | null): string | null {
  return url ? url.replace('/normal/', '/large/') : null;
}

export function DraftReplayViewer({ stream, step: initialStep, returnHash }: DraftReplayViewerProps) {
  const steps = useMemo(() => buildDraftSteps(stream), [stream]);
  const playback = useStepPlayback(steps, { initialIndex: indexOfKey(steps, initialStep) ?? 0 });
  const [firstShown] = useState(() => {
    const opening = steps[playback.index];
    return opening ? [...opening.packCards, ...opening.missing.map((m) => m.arena_id), ...opening.poolBefore, ...opening.picked] : [];
  });
  const images: DraftImages = useDraftImages(stream, firstShown);
  const [winRates, setWinRates] = useState(readWinRatesPref);
  const ratings = useSeventeenLandsRatings(stream, winRates);
  const [hidePicks, setHidePicks] = useState(false);
  const [revealed, setRevealed] = useState<number | null>(null);
  const [deckOpen, setDeckOpen] = useState(false);
  const [deckButton, setDeckButton] = useState<HTMLButtonElement | null>(null);
  const togglePicks = useCallback(() => setHidePicks((hide) => !hide), []);
  const toggleWinRates = useCallback(() => {
    setWinRates((on) => {
      try {
        localStorage.setItem(WIN_RATES_KEY, on ? 'off' : 'on');
      } catch {
        // Preference just is not remembered.
      }
      return !on;
    });
  }, []);
  const onExtraKey = useCallback(
    (key: string) => {
      if (key === 'h' || key === 'H') {
        togglePicks();
        return true;
      }
      if ((key === 'r' || key === 'R') && hidePicks) {
        setRevealed(playback.index);
        return true;
      }
      return false;
    },
    [hidePicks, playback.index, togglePicks],
  );
  useStepKeyboard(playback, deckOpen ? undefined : onExtraKey);

  const current = steps[playback.index];
  const draftId = stream.draft.id;
  const written = useRef(current?.key);
  useEffect(() => {
    if (!current || playback.playing || current.key === written.current) return;
    const timer = setTimeout(() => {
      written.current = current.key;
      if (parseDraftReplayRoute(window.location.hash)?.draftId !== draftId) return;
      try {
        window.history.replaceState(window.history.state, '', draftReplayRouteHash(draftId, { step: current.key, returnHash }));
      } catch {
        // History unavailable: the link stays at its old position.
      }
    }, HASH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [current, draftId, playback.playing, returnHash]);

  // Download the next picks' art in the background so stepping never waits.
  useEffect(() => {
    const ahead = steps.slice(playback.index, playback.index + 3).flatMap((s) => [...s.packCards, ...s.missing.map((m) => m.arena_id)]);
    preloadImages(ahead.map((arenaId) => images.url(arenaId)));
  }, [images, playback.index, steps]);

  // A larger copy of a card after a short hover, like Arena.
  const [hover, setHover] = useState<HoverPreview | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHover = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setHover(null);
  }, []);
  const stepIndex = playback.index;
  const onCardOver = useCallback((event: MouseEvent<HTMLElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-arena-id]');
    if (!target) return;
    const arenaId = Number(target.dataset.arenaId);
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      const rect = target.getBoundingClientRect();
      const width = 300;
      const height = width * (88 / 63);
      const right = rect.right + 12 + width <= window.innerWidth;
      setHover({
        arenaId,
        index: stepIndex,
        left: right ? rect.right + 12 : Math.max(8, rect.left - 12 - width),
        top: Math.max(8, Math.min(window.innerHeight - height - 8, rect.top + rect.height / 2 - height / 2)),
      });
    }, HOVER_PREVIEW_MS);
  }, [stepIndex]);
  const onCardOut = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const from = (event.target as HTMLElement).closest('[data-arena-id]');
      const to = (event.relatedTarget as HTMLElement | null)?.closest?.('[data-arena-id]');
      if (from && from !== to) clearHover();
    },
    [clearHover],
  );
  useEffect(() => clearHover, [clearHover]);

  const showPick = !hidePicks || revealed === playback.index;
  const pool = useMemo(() => {
    if (!current) return [];
    return showPick ? [...current.poolBefore, ...current.picked] : current.poolBefore;
  }, [current, showPick]);
  const summary = useMemo(() => summarizePool(stream, pool), [pool, stream]);
  const deckCounts = useMemo(() => mainDeckCounts(stream), [stream]);
  const hasDeck = deckCounts.size > 0;
  const columns = useMemo(() => {
    const out = new Map<PoolColumn, number[]>(POOL_COLUMNS.map((column) => [column, []]));
    for (const arenaId of pool) out.get(poolColumn(cardFor(stream, arenaId)))?.push(arenaId);
    for (const cards of out.values()) cards.sort((a, b) => compareByRarity(cardFor(stream, a), cardFor(stream, b)));
    return out;
  }, [pool, stream]);
  const poolInDeck = useMemo(() => inDeckFlags(pool, deckCounts), [deckCounts, pool]);
  const poolDeckTotal = poolInDeck.filter(Boolean).length;
  const startedAt = useMemo(() => (stream.draft.started_at ? formatDateTime(stream.draft.started_at) : null), [stream.draft.started_at]);
  const back = returnHash ?? REPLAY_ROUTE_HASH;
  const here = draftReplayRouteHash(draftId, { step: current?.key, returnHash });

  if (!current) {
    return (
      <div className="replay-page replay-page-state">
        <p className="state-panel">This draft has no recorded picks.</p>
        <a className="replay-back" href={back}>
          ← Back
        </a>
      </div>
    );
  }

  // Which pool copies made the deck, per column (the first N copies of a card the deck plays N of).
  const deckLeft = new Map(deckCounts);
  const takeDeckCopy = (arenaId: number) => {
    const n = deckLeft.get(arenaId) ?? 0;
    if (n > 0) deckLeft.set(arenaId, n - 1);
    return n > 0;
  };
  // The newest copies in the pool are this step's pick (highlighted in their column).
  const fresh = new Map<number, number>();
  if (showPick) for (const arenaId of current.picked) fresh.set(arenaId, (fresh.get(arenaId) ?? 0) + 1);
  const pickedLeft = new Map(fresh);
  const packCards = byRarity(stream, current.packCards.length ? current.packCards : current.picked);
  const inDeckBadge = <span className="draft-deck-badge" title="Made the final deck">In deck</span>;
  const shownHover = hover?.index === playback.index ? hover : null;
  const hoverCard = shownHover ? cardFor(stream, shownHover.arenaId) : null;

  return (
    <div className="replay-page draft-replay" onMouseOver={onCardOver} onMouseOut={onCardOut}>
      <header className="replay-header">
        <a className="replay-back" href={back}>
          ← Back
        </a>
        <h2 className="replay-title">
          {stream.draft.format_label}
          <span className="replay-vs">{stream.draft.kind === 'bot' ? 'Bot draft' : 'Player draft'}</span>
        </h2>
        {startedAt ? <span className="replay-meta">{startedAt}</span> : null}
        <Badge tone={stream.draft.completed_at ? 'win' : 'neutral'}>{stream.draft.completed_at ? 'Complete' : 'Incomplete'}</Badge>
        <div className="replay-header-actions">
          <button
            type="button"
            className="replay-btn"
            aria-pressed={winRates}
            onClick={toggleWinRates}
            title={ratings ? `17lands games-in-hand win rate · ${ratings.source}` : '17lands games-in-hand win rate'}
          >
            {winRates ? 'Win rates on' : 'Win rates off'}
          </button>
          <button
            type="button"
            className="replay-btn"
            aria-pressed={hidePicks}
            onClick={togglePicks}
            title="Hide each pick until you reveal it, to test yourself (H; R reveals)"
          >
            {hidePicks ? 'Picks hidden' : 'Hide picks'}
          </button>
          <button
            ref={setDeckButton}
            type="button"
            className="replay-btn draft-deck-btn"
            disabled={!stream.deck}
            onClick={() => setDeckOpen(true)}
            title={stream.deck ? 'The deck you built from this draft' : 'No deck was submitted while the tracker was watching'}
          >
            Final deck
          </button>
        </div>
      </header>

      <div className="draft-stage">
        <section className="draft-pack-area" aria-label="Pack">
          <div className="draft-pack-head">
            <h3 className="draft-pick-title">{current.label}</h3>
            <SeenBanner step={current} steps={steps} />
            {winRates && ratings ? (
              <span className="draft-wr-legend" title={`17lands games-in-hand win rate · ${ratings.source}`}>
                <span className="draft-wr-scale" aria-hidden="true" />
                GIH WR · avg {formatWinRate(ratings.mean)}
              </span>
            ) : null}
            {hidePicks && revealed !== playback.index ? (
              <button type="button" className="replay-btn draft-reveal" onClick={() => setRevealed(playback.index)}>
                Reveal pick (R)
              </button>
            ) : null}
          </div>
          <div className="draft-pack-grid">
            {packCards.map((arenaId, n) => {
              const picked = showPick && pickedLeft.get(arenaId);
              if (picked) pickedLeft.set(arenaId, picked - 1);
              const madeDeck = Boolean(picked) && hasDeck && (deckCounts.get(arenaId) ?? 0) > 0;
              return (
                <div
                  key={`${current.key}-${n}`}
                  className={`draft-pack-slot${heatStyle(arenaId, ratings) ? ' draft-heat' : ''}`}
                  style={heatStyle(arenaId, ratings)}
                  data-arena-id={arenaId}
                >
                  <DraftCardImage
                    card={cardFor(stream, arenaId)}
                    url={images.url(arenaId)}
                    className={picked ? 'draft-card-picked' : ''}
                    badge={madeDeck ? inDeckBadge : null}
                  />
                  <RatingChip arenaId={arenaId} ratings={ratings} />
                </div>
              );
            })}
          </div>
          {current.missing.length ? (
            <section className="draft-missing" aria-label={`Missing since pick ${current.seenPick}`}>
              <h4>
                Missing since Pick {current.seenPick} <span className="draft-missing-note">rarest first</span>
              </h4>
              <div className="draft-missing-row">
                {current.missing.map((missing, n) => (
                  <figure key={`${missing.arena_id}-${n}`} className="draft-missing-card" data-arena-id={missing.arena_id}>
                    <DraftCardImage card={cardFor(stream, missing.arena_id)} url={images.url(missing.arena_id)} />
                    <figcaption>
                      {missing.takenByYou && showPick ? <span className="draft-your-pick">Your pick</span> : null}
                      <RatingChip arenaId={missing.arena_id} ratings={ratings} />
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ) : null}
        </section>

        <aside className="draft-pool" aria-label="Deck so far">
          <div className="draft-pool-head">
            <h3>Deck so far</h3>
            <span className="draft-pool-count">{summary.total} cards</span>
          </div>
          <div className="draft-pool-summary">
            {summary.colors.map(({ color, count }) => (
              <span key={color} className="draft-pool-color">
                <ColorPips colors={color} size={13} /> {count}
              </span>
            ))}
            <span className="draft-pool-types">
              {summary.creatures} creatures · {summary.noncreatures} spells
              {summary.lands ? ` · ${summary.lands} lands` : ''}
            </span>
          </div>
          {hasDeck ? (
            <p className="draft-pool-deck-note">
              <span className="draft-deck-badge">In deck</span> {poolDeckTotal} of these made the final deck; the rest are dimmed.
            </p>
          ) : null}
          <div className="draft-pool-columns">
            {POOL_COLUMNS.map((column) => {
              const cards = columns.get(column) ?? [];
              if (!cards.length) return null;
              const freshLeft = new Map(fresh);
              return (
                <div key={column} className="draft-pool-column">
                  <span className="draft-pool-column-label">
                    {column} <small>({cards.length})</small>
                  </span>
                  <div className="draft-pool-stack">
                    {cards.map((arenaId, n) => {
                      const isNew = freshLeft.get(arenaId);
                      if (isNew) freshLeft.set(arenaId, isNew - 1);
                      const madeDeck = hasDeck && takeDeckCopy(arenaId);
                      const classes = [isNew ? 'draft-card-new' : '', hasDeck ? (madeDeck ? 'draft-card-indeck' : 'draft-card-cut') : '']
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <div key={`${column}-${arenaId}-${n}`} className="draft-pool-slot" data-arena-id={arenaId}>
                          <DraftCardImage card={cardFor(stream, arenaId)} url={images.url(arenaId)} className={classes} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {!pool.length ? <p className="draft-pool-empty">Nothing picked yet.</p> : null}
          </div>
        </aside>
      </div>

      <StepControls
        steps={steps}
        playback={playback}
        groupNoun="Pack"
        stepNoun="Pick"
        isMarked={(index) => steps[index]?.seenAt !== null}
      />

      {shownHover && hoverCard ? (
        <div className="draft-hover-preview" style={{ left: shownHover.left, top: shownHover.top }} aria-hidden="true">
          <DraftCardImage card={hoverCard} url={largeUrl(images.url(shownHover.arenaId))} />
          {ratings?.byArenaId.get(shownHover.arenaId)?.gihWr != null ? (
            <span className="draft-hover-wr">
              17lands GIH WR {formatWinRate(ratings.byArenaId.get(shownHover.arenaId)?.gihWr ?? 0)}
            </span>
          ) : null}
        </div>
      ) : null}

      {deckOpen && stream.deck ? (
        <FinalDeckDialog
          stream={stream}
          deck={stream.deck}
          returnHash={here}
          returnFocus={deckButton}
          onClose={() => setDeckOpen(false)}
        />
      ) : null}
    </div>
  );
}
