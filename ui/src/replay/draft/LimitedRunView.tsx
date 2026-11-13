/**
 * A run without picks — a sealed course, or a run rebuilt from games — at
 * `#/replay/draft/<id>`: its record, its pool in Arena's mana-value columns
 * (cards that made the deck outlined, the rest dimmed) and the deck itself in
 * Deck Manager's layout.
 */
import { useMemo } from 'react';
import { Badge } from '../../components/Badge';
import { WinRatePill } from '../../components/WinRatePill';
import { formatDateTime } from '../../format';
import { REPLAY_ROUTE_HASH, draftReplayRouteHash } from '../../routes';
import { DraftCardImage } from './DraftCardImage';
import { DeckDetailBody } from './FinalDeckDialog';
import { useDraftImages } from './draftImages';
import { POOL_COLUMNS, cardFor, compareByRarity, mainDeckCounts, poolColumn, type PoolColumn } from './model';
import type { DraftStream } from './types';

export function LimitedRunView({ stream, returnHash }: { stream: DraftStream; returnHash: string | null }) {
  const images = useDraftImages(stream);
  const deck = stream.deck ?? null;
  const pool = useMemo(() => {
    const cards = stream.pool.length ? [...stream.pool] : (deck?.main ?? []).flatMap((c) => Array<number>(c.quantity).fill(c.arena_id));
    return cards.filter((arenaId) => cardFor(stream, arenaId).rarity !== 'basic');
  }, [deck, stream]);
  const columns = useMemo(() => {
    const out = new Map<PoolColumn, number[]>(POOL_COLUMNS.map((column) => [column, []]));
    for (const arenaId of pool) out.get(poolColumn(cardFor(stream, arenaId)))?.push(arenaId);
    for (const cards of out.values()) cards.sort((a, b) => compareByRarity(cardFor(stream, a), cardFor(stream, b)));
    return out;
  }, [pool, stream]);
  const deckCounts = useMemo(() => mainDeckCounts(stream), [stream]);
  const record = stream.draft.record;
  const back = returnHash ?? REPLAY_ROUTE_HASH;
  const here = draftReplayRouteHash(stream.draft.id, { returnHash });
  const deckLeft = new Map(deckCounts);
  const inDeck = (arenaId: number) => {
    const n = deckLeft.get(arenaId) ?? 0;
    if (n > 0) deckLeft.set(arenaId, n - 1);
    return n > 0;
  };
  const kindLabel = stream.draft.kind === 'sealed' ? 'Sealed' : 'Draft';

  return (
    <div className="replay-page draft-replay limited-run">
      <header className="replay-header">
        <a className="replay-back" href={back}>
          ← Back
        </a>
        <h2 className="replay-title">
          {stream.draft.format_label}
          <span className="replay-vs">{stream.draft.rebuilt ? `${kindLabel} · rebuilt from games` : kindLabel}</span>
        </h2>
        {stream.draft.started_at ? <span className="replay-meta">{formatDateTime(stream.draft.started_at)}</span> : null}
        {record ? (
          <span className="replay-meta limited-run-record">
            <WinRatePill wins={record.wins} losses={record.losses} />
            {record.games ? `${record.wins}–${record.losses}` : 'No games yet'}
          </span>
        ) : null}
        {stream.draft.rebuilt ? null : (
          <Badge tone={stream.draft.completed_at ? 'win' : 'neutral'}>{stream.draft.completed_at ? 'Complete' : 'In progress'}</Badge>
        )}
      </header>
      <div className="draft-stage">
        <section className="draft-pool limited-run-pool" aria-label="Pool">
          <div className="draft-pool-head">
            <h3>{stream.draft.rebuilt ? 'Cards seen in your decks' : `${kindLabel} pool`}</h3>
            <span className="draft-pool-count">{pool.length} cards</span>
          </div>
          {deck ? (
            <p className="draft-pool-deck-note">
              <span className="draft-deck-badge">In deck</span> outlined; the rest are dimmed.
            </p>
          ) : null}
          <div className="draft-pool-columns">
            {POOL_COLUMNS.map((column) => {
              const cards = columns.get(column) ?? [];
              if (!cards.length) return null;
              return (
                <div key={column} className="draft-pool-column">
                  <span className="draft-pool-column-label">
                    {column} <small>({cards.length})</small>
                  </span>
                  <div className="draft-pool-stack">
                    {cards.map((arenaId, n) => {
                      const made = deck ? inDeck(arenaId) : false;
                      return (
                        <div key={`${column}-${arenaId}-${n}`} className="draft-pool-slot">
                          <DraftCardImage
                            card={cardFor(stream, arenaId)}
                            url={images.url(arenaId)}
                            className={deck ? (made ? 'draft-card-indeck' : 'draft-card-cut') : ''}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {!pool.length ? <p className="draft-pool-empty">No pool was recorded for this run.</p> : null}
          </div>
        </section>
        <section className="limited-run-deck" aria-label="Deck">
          {deck ? <DeckDetailBody stream={stream} deck={deck} returnHash={here} /> : <p className="empty-state">No deck was submitted while the tracker was watching.</p>}
        </section>
      </div>
    </div>
  );
}
