import { useEffect, useMemo, useState } from 'react';
import { fetchDrafts, importDraftsFromLog } from '../api';
import { formatDateTime } from '../format';
import type { DraftListRow } from '../replay/draft/types';
import { REPLAY_ROUTE_HASH, draftReplayRouteHash } from '../routes';
import type { DeckVisual as DeckVisualData } from '../api';
import { Badge } from './Badge';
import { ColorPips } from './ColorPips';
import { DeckVisual } from './DeckVisual';
import { Section } from './Section';
import { WinRatePill } from './WinRatePill';
import { useCardArt } from '../replay/useCardArt';

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; drafts: DraftListRow[] }
  | { status: 'error'; message: string };

/** Tile art: the first pick's art crop (by name first: new sets reach Scryfall before their Arena ids). */
function tileCard(row: DraftListRow) {
  const shown = row.first_pick ?? row.top_card ?? null;
  return shown?.name && !shown.name.startsWith('Card #') ? shown : null;
}

/**
 * Tile art: a draft's first pick, or a sealed run's rarest deck card, as a CDN
 * art crop resolved in one batch for the whole list (see useCardArt).
 */
function firstPickArt(row: DraftListRow, artUrl: string | null): DeckVisualData {
  const shown = tileCard(row);
  return {
    card_id: shown?.arena_id ?? null,
    card_name: shown?.name ?? null,
    type_category: 'Other',
    source: 'local_metadata',
    image_url: artUrl,
  };
}

type ImportState = { status: 'idle' } | { status: 'running' } | { status: 'done'; message: string } | { status: 'error'; message: string };

/**
 * Replay list "Drafts" section: every draft the tracker recorded, newest
 * first, with a button that rescans Arena's logs for drafts made while the
 * tracker was not running.
 */
export function DraftReplayList() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [importState, setImportState] = useState<ImportState>({ status: 'idle' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchDrafts(controller.signal).then(
      (drafts) => setLoad({ status: 'loaded', drafts }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: 'error', message: error instanceof Error ? error.message : 'Drafts API failed' });
      },
    );
    return () => controller.abort();
  }, [reloadToken]);

  async function runImport() {
    setImportState({ status: 'running' });
    try {
      const result = await importDraftsFromLog();
      setImportState({
        status: 'done',
        message: result.logs.length
          ? `Checked ${result.logs.join(' and ')}: ${result.drafts} draft${result.drafts === 1 ? '' : 's'} found.`
          : "Arena's log was not found.",
      });
      setReloadToken((token) => token + 1);
    } catch (error) {
      setImportState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  const drafts = useMemo(() => (load.status === 'loaded' ? load.drafts : []), [load]);
  const artNames = useMemo(() => drafts.map((row) => tileCard(row)?.name), [drafts]);
  const art = useCardArt(artNames);
  return (
    <Section id="replay-drafts" title="Drafts & sealed" collapsible={false}>
      <p className="replay-list-intro">
        Every draft and sealed run with its own record. Step through a draft pick by pick, or open a sealed run to see
        its pool and the deck you built. Runs from before the tracker kept them are rebuilt from your games.
      </p>
      <div className="draft-list-actions">
        <button type="button" className="retry-button" onClick={runImport} disabled={importState.status === 'running'}>
          {importState.status === 'running' ? 'Reading Arena logs…' : 'Find past drafts in Arena logs'}
        </button>
        {importState.status === 'done' || importState.status === 'error' ? (
          <span className="draft-list-status" role="status">
            {importState.message}
          </span>
        ) : null}
      </div>
      {load.status === 'loading' ? (
        <p className="state-panel" role="status" aria-busy="true">
          Loading drafts...
        </p>
      ) : load.status === 'error' ? (
        <p className="state-panel error-state" role="alert">
          {load.message}
        </p>
      ) : drafts.length === 0 ? (
        <p className="empty-state">
          No drafts recorded yet. Draft with the tracker running, or look for earlier drafts in Arena's logs above.
        </p>
      ) : (
        <div className="replay-deck-tiles" role="list" aria-label="Drafts and sealed runs">
          {drafts.map((row) => (
            <div role="listitem" key={row.id}>
              <a
                className="deck-manager-tile replay-deck-tile"
                href={draftReplayRouteHash(row.id, { returnHash: REPLAY_ROUTE_HASH })}
                title={`Replay draft: ${row.format_label}`}
              >
                <span className="deck-manager-tile-art">
                  <DeckVisual deckName={row.format_label} visual={firstPickArt(row, art(tileCard(row)?.name))} />
                  <ColorPips colors={row.colors} size={14} />
                </span>
                <span className="deck-manager-tile-text">
                  <strong>
                    {row.format_label}
                    {row.kind === 'bot' ? <span className="replay-vs"> · bots</span> : null}
                  </strong>
                  <small className="replay-tile-record">
                    <WinRatePill wins={row.record?.wins ?? 0} losses={row.record?.losses ?? 0} />
                    {row.record?.games ? `${row.record.wins}–${row.record.losses}` : 'No games yet'}
                  </small>
                  <small>{row.started_at ? formatDateTime(row.started_at) : 'Date unknown'}</small>
                  {row.picks ? (
                    <>
                      <small>First pick: {row.first_pick?.name ?? '—'}</small>
                      <small className="replay-draft-tile-status">
                        {row.picks} picks
                        <Badge tone={row.completed_at ? 'win' : 'neutral'}>{row.completed_at ? 'Complete' : 'Incomplete'}</Badge>
                      </small>
                    </>
                  ) : (
                    <>
                      <small>Best card: {row.top_card?.name ?? '—'}</small>
                      <small className="replay-draft-tile-status">
                        {row.rebuilt
                          ? 'Rebuilt from games'
                          : row.pool_size
                            ? `${row.kind === 'sealed' ? 'Sealed pool' : 'Pool'} · ${row.pool_size} cards`
                            : 'No picks recorded'}
                        {row.rebuilt ? null : (
                          <Badge tone={row.completed_at ? 'win' : 'neutral'}>{row.completed_at ? 'Complete' : 'In progress'}</Badge>
                        )}
                      </small>
                    </>
                  )}
                </span>
              </a>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
