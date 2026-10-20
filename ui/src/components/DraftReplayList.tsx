import { useEffect, useState } from 'react';
import { fetchDrafts, importDraftsFromLog } from '../api';
import { formatDateTime } from '../format';
import type { DraftListRow } from '../replay/draft/types';
import { REPLAY_ROUTE_HASH, draftReplayRouteHash } from '../routes';
import type { DeckVisual as DeckVisualData } from '../api';
import { Badge } from './Badge';
import { ColorPips } from './ColorPips';
import { DeckVisual } from './DeckVisual';
import { Section } from './Section';

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; drafts: DraftListRow[] }
  | { status: 'error'; message: string };

/** Tile art: the first pick's art crop (by name first: new sets reach Scryfall before their Arena ids). */
function firstPickArt(row: DraftListRow): DeckVisualData {
  const name = row.first_pick?.name && !row.first_pick.name.startsWith('Card #') ? row.first_pick.name : null;
  const byName = name
    ? `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=art_crop`
    : null;
  const byId = row.first_pick ? `https://api.scryfall.com/cards/arena/${row.first_pick.arena_id}?format=image&version=art_crop` : null;
  return {
    card_id: row.first_pick?.arena_id ?? null,
    card_name: name,
    type_category: 'Other',
    source: 'local_metadata',
    image_url: byName ?? byId,
    image_fallback_url: byName ? byId : null,
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

  const drafts = load.status === 'loaded' ? load.drafts : [];
  return (
    <Section id="replay-drafts" title="Drafts" collapsible={false}>
      <p className="replay-list-intro">
        Step through a draft pick by pick: every pack you saw, what you took, which cards were gone when a pack came
        back around, and your deck as it came together.
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
        <div className="replay-deck-tiles" role="list" aria-label="Drafts">
          {drafts.map((row) => (
            <div role="listitem" key={row.id}>
              <a
                className="deck-manager-tile replay-deck-tile"
                href={draftReplayRouteHash(row.id, { returnHash: REPLAY_ROUTE_HASH })}
                title={`Replay draft: ${row.format_label}`}
              >
                <span className="deck-manager-tile-art">
                  <DeckVisual deckName={row.format_label} visual={firstPickArt(row)} />
                  <ColorPips colors={row.colors} size={14} />
                </span>
                <span className="deck-manager-tile-text">
                  <strong>
                    {row.format_label}
                    {row.kind === 'bot' ? <span className="replay-vs"> · bots</span> : null}
                  </strong>
                  <small>{row.started_at ? formatDateTime(row.started_at) : 'Date unknown'}</small>
                  <small>First pick: {row.first_pick?.name ?? '—'}</small>
                  <small className="replay-draft-tile-status">
                    {row.picks} picks
                    <Badge tone={row.completed_at ? 'win' : 'neutral'}>{row.completed_at ? 'Complete' : 'Incomplete'}</Badge>
                  </small>
                </span>
              </a>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
