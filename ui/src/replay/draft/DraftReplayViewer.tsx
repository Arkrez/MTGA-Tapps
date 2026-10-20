/**
 * The loaded Draft Replay: the pack in front of the player with the pick
 * highlighted, a "seen before" banner and the cards missing since then when
 * the pack wheeled, the pool as it is assembled (MTGA's mana-value columns),
 * and the framework transport bar. `?step=` keeps the position shareable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '../../components/Badge';
import { ColorPips } from '../../components/ColorPips';
import { formatDateTime } from '../../format';
import { REPLAY_ROUTE_HASH, draftReplayRouteHash, parseDraftReplayRoute } from '../../routes';
import { StepControls } from '../framework/StepControls';
import { indexOfKey } from '../framework/timeline';
import { useStepKeyboard, useStepPlayback } from '../framework/useStepPlayback';
import { DraftCardImage } from './DraftCardImage';
import {
  POOL_COLUMNS,
  buildDraftSteps,
  cardFor,
  compareByRarity,
  poolColumn,
  summarizePool,
  type DraftStep,
  type PoolColumn,
} from './model';
import type { DraftStream } from './types';

const HASH_DEBOUNCE_MS = 300;

interface DraftReplayViewerProps {
  stream: DraftStream;
  step: string | null;
  returnHash: string | null;
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

export function DraftReplayViewer({ stream, step: initialStep, returnHash }: DraftReplayViewerProps) {
  const steps = useMemo(() => buildDraftSteps(stream), [stream]);
  const playback = useStepPlayback(steps, { initialIndex: indexOfKey(steps, initialStep) ?? 0 });
  const [hidePicks, setHidePicks] = useState(false);
  const [revealed, setRevealed] = useState<number | null>(null);
  const togglePicks = useCallback(() => setHidePicks((hide) => !hide), []);
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
  useStepKeyboard(playback, onExtraKey);

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

  const showPick = !hidePicks || revealed === playback.index;
  const pool = useMemo(() => {
    if (!current) return [];
    return showPick ? [...current.poolBefore, ...current.picked] : current.poolBefore;
  }, [current, showPick]);
  const summary = useMemo(() => summarizePool(stream, pool), [pool, stream]);
  const columns = useMemo(() => {
    const out = new Map<PoolColumn, number[]>(POOL_COLUMNS.map((column) => [column, []]));
    for (const arenaId of pool) out.get(poolColumn(cardFor(stream, arenaId)))?.push(arenaId);
    for (const cards of out.values()) cards.sort((a, b) => compareByRarity(cardFor(stream, a), cardFor(stream, b)));
    return out;
  }, [pool, stream]);
  const startedAt = useMemo(() => (stream.draft.started_at ? formatDateTime(stream.draft.started_at) : null), [stream.draft.started_at]);
  const back = returnHash ?? REPLAY_ROUTE_HASH;

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

  // The newest copies in the pool are this step's pick (highlighted in their column).
  const fresh = new Map<number, number>();
  if (showPick) for (const arenaId of current.picked) fresh.set(arenaId, (fresh.get(arenaId) ?? 0) + 1);
  const pickedLeft = new Map(fresh);

  return (
    <div className="replay-page draft-replay">
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
            aria-pressed={hidePicks}
            onClick={togglePicks}
            title="Hide each pick until you reveal it, to test yourself (H; R reveals)"
          >
            {hidePicks ? 'Picks hidden' : 'Hide picks'}
          </button>
        </div>
      </header>

      <div className="draft-stage">
        <section className="draft-pack-area" aria-label="Pack">
          <div className="draft-pack-head">
            <h3 className="draft-pick-title">{current.label}</h3>
            <SeenBanner step={current} steps={steps} />
            {hidePicks && revealed !== playback.index ? (
              <button type="button" className="replay-btn draft-reveal" onClick={() => setRevealed(playback.index)}>
                Reveal pick (R)
              </button>
            ) : null}
          </div>
          <div className="draft-pack-grid">
            {(current.packCards.length ? current.packCards : current.picked).map((arenaId, n) => {
              const picked = showPick && pickedLeft.get(arenaId);
              if (picked) pickedLeft.set(arenaId, picked - 1);
              return (
                <DraftCardImage
                  key={`${current.key}-${n}`}
                  card={cardFor(stream, arenaId)}
                  priority={2}
                  className={picked ? 'draft-card-picked' : ''}
                />
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
                  <figure key={`${missing.arena_id}-${n}`} className="draft-missing-card">
                    <DraftCardImage card={cardFor(stream, missing.arena_id)} priority={1} />
                    <figcaption>{missing.takenByYou && showPick ? <span className="draft-your-pick">Your pick</span> : null}</figcaption>
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
                      return (
                        <DraftCardImage
                          key={`${column}-${arenaId}-${n}`}
                          card={cardFor(stream, arenaId)}
                          className={isNew ? 'draft-card-new' : ''}
                        />
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
    </div>
  );
}
