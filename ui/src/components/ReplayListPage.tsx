import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { fetchAllGames, type AllGamesRow } from '../api';
import { formatDateTime, formatDuration, formatNumber, outcomeLabel, outcomeTone, shortFormatLabel } from '../format';
import { quickFilterPredicate } from '../quickFilters';
import { REPLAY_ROUTE_HASH, replayRouteHash } from '../routes';
import { Badge } from './Badge';
import { DraftReplayList } from './DraftReplayList';
import { ColorPips } from './ColorPips';
import { FormatQuickFilters } from './FormatQuickFilters';
import { replayState, replayStateLabel, replayStateTitle } from '../replayAvailability';
import { ReplayLink } from './ReplayLink';
import { Section } from './Section';

export const REPLAY_LIST_PAGE_SIZE = 25;

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; games: AllGamesRow[] }
  | { status: 'error'; message: string };

function navigateTo(hash: string): void {
  window.location.hash = hash;
}

function opponentLabel(row: AllGamesRow): string {
  return row.opponent_name?.trim() || 'Opponent';
}

function formatCell(row: AllGamesRow): string {
  const label = shortFormatLabel(row.format_label);
  return (row.best_of ?? 1) > 1 && row.game_number ? `${label} · Game ${row.game_number}` : label;
}

/**
 * `#/replay`: pick a game to watch. Reuses the All Games endpoint (rows carry
 * `replay` availability) — newest first, 25 at a time.
 */
export function ReplayListPage() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [quickFilter, setQuickFilter] = useState('all');
  const [deckQuery, setDeckQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(REPLAY_LIST_PAGE_SIZE);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    window.scrollTo(0, 0);
    const controller = new AbortController();
    fetchAllGames({}, controller.signal)
      .then((response) => setLoadState({ status: 'loaded', games: response.games }))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        setLoadState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Games API failed',
        });
      });
    return () => controller.abort();
  }, [retryToken]);

  const games = useMemo(() => (loadState.status === 'loaded' ? loadState.games : []), [loadState]);
  const filtered = useMemo(() => {
    const matchesQuick = quickFilterPredicate(quickFilter);
    const needle = deckQuery.trim().toLocaleLowerCase();
    return games
      .filter((row) => matchesQuick(row.format_label.toLocaleLowerCase()))
      .filter((row) => !needle || row.deck_name.toLocaleLowerCase().includes(needle))
      .sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''));
  }, [deckQuery, games, quickFilter]);
  const shown = filtered.slice(0, visibleCount);

  function openRow(row: AllGamesRow, event: MouseEvent<HTMLTableRowElement>) {
    if ((event.target as HTMLElement).closest('a, button')) {
      return;
    }
    if (replayState(row.replay) === 'unavailable') {
      return;
    }
    navigateTo(replayRouteHash(row.game_id, { returnHash: REPLAY_ROUTE_HASH }));
  }

  if (loadState.status === 'loading') {
    return (
      <p className="state-panel" role="status" aria-busy="true">
        Loading games...
      </p>
    );
  }
  if (loadState.status === 'error') {
    return (
      <div className="state-panel error-state" role="alert">
        <p>{loadState.message}</p>
        <button className="retry-button" type="button" onClick={() => setRetryToken((token) => token + 1)}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <p className="state-panel replay-narrow-notice">
        Replays need a wider screen. Open the dashboard on a tablet or computer to watch a game.
      </p>
      <div className="replay-list-page replay-wide-only">
        <Section id="replay-games" collapsible={false}>
          <p className="replay-list-intro">
            Pick a game to watch it play out turn by turn. Recorded games replay exactly; older games
            are reconstructed from the event log.
          </p>
          {games.length === 0 ? (
            <p className="empty-state">
              No tracked games yet. Finish a game of MTG Arena with the tracker running and it shows
              up here.
            </p>
          ) : (
            <>
              <FormatQuickFilters
                value={quickFilter}
                onChange={(id) => {
                  setQuickFilter(id);
                  setVisibleCount(REPLAY_LIST_PAGE_SIZE);
                }}
              />
              <div className="replay-list-controls">
                <input
                  aria-label="Filter by deck"
                  placeholder="Filter by deck"
                  type="search"
                  value={deckQuery}
                  onChange={(event) => {
                    setDeckQuery(event.target.value);
                    setVisibleCount(REPLAY_LIST_PAGE_SIZE);
                  }}
                />
              </div>
              {filtered.length === 0 ? (
                <p className="empty-state">No games match these filters.</p>
              ) : (
                <div className="table-container">
                  <div className="table-wrap replay-list-table" role="region" aria-label="Games to replay" tabIndex={0}>
                    <table>
                      <caption>Games to replay</caption>
                      <thead>
                        <tr>
                          <th scope="col">Date</th>
                          <th scope="col" className="center">
                            Result
                          </th>
                          <th scope="col">Deck</th>
                          <th scope="col">Opponent</th>
                          <th scope="col">Format</th>
                          <th scope="col" className="num replay-col-turns">
                            Turns
                          </th>
                          <th scope="col" className="num">
                            Duration
                          </th>
                          <th scope="col">Replay</th>
                          <th scope="col">
                            <span className="visually-hidden">Watch</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((row) => {
                          const unavailable = replayState(row.replay) === 'unavailable';
                          return (
                            <tr
                              key={row.game_id}
                              className={unavailable ? 'replay-row-unavailable' : undefined}
                              data-game-id={row.game_id}
                              onClick={(event) => openRow(row, event)}
                            >
                              <td>{formatDateTime(row.started_at)}</td>
                              <td className="center">
                                <Badge tone={outcomeTone(row.outcome)}>{outcomeLabel(row.outcome)}</Badge>
                              </td>
                              <td className="replay-cell-deck">{row.deck_name}</td>
                              <td>
                                <span className="replay-opponent">
                                  <span className="replay-opponent-name" title={opponentLabel(row)}>
                                    {opponentLabel(row)}
                                  </span>
                                  {row.opp_colors ? <ColorPips colors={row.opp_colors} /> : null}
                                </span>
                              </td>
                              <td>{formatCell(row)}</td>
                              <td className="num replay-col-turns">{formatNumber(row.total_turns)}</td>
                              <td className="num">{formatDuration(row.duration_seconds)}</td>
                              <td>
                                <span
                                  className={`replay-state replay-state-${replayState(row.replay)}`}
                                  title={replayStateTitle(row.replay)}
                                >
                                  {replayStateLabel(row.replay)}
                                </span>
                              </td>
                              <td className="replay-cell-action">
                                <ReplayLink
                                  availability={row.replay}
                                  gameId={row.game_id}
                                  returnHash={REPLAY_ROUTE_HASH}
                                  variant="icon"
                                  label={`Watch replay: ${row.deck_name} vs ${opponentLabel(row)}, ${formatDateTime(row.started_at)}`}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {filtered.length > 0 ? (
                <div className="replay-list-more">
                  <span>
                    Showing {shown.length} of {filtered.length}
                  </span>
                  {shown.length < filtered.length ? (
                    <button type="button" onClick={() => setVisibleCount((count) => count + REPLAY_LIST_PAGE_SIZE)}>
                      Show more
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </Section>
        <DraftReplayList />
      </div>
    </>
  );
}
