import { useEffect, useState, type MouseEvent } from 'react';
import { fetchDrafts, importDraftsFromLog } from '../api';
import { formatDateTime } from '../format';
import type { DraftListRow } from '../replay/draft/types';
import { REPLAY_ROUTE_HASH, draftReplayRouteHash } from '../routes';
import { Badge } from './Badge';
import { ColorPips } from './ColorPips';
import { Section } from './Section';

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; drafts: DraftListRow[] }
  | { status: 'error'; message: string };

function navigateTo(hash: string): void {
  window.location.hash = hash;
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

  function openRow(row: DraftListRow, event: MouseEvent<HTMLTableRowElement>) {
    if ((event.target as HTMLElement).closest('a, button')) return;
    navigateTo(draftReplayRouteHash(row.id, { returnHash: REPLAY_ROUTE_HASH }));
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
        <div className="table-container">
          <div className="table-wrap replay-list-table" role="region" aria-label="Drafts to replay" tabIndex={0}>
            <table>
              <caption>Drafts to replay</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Event</th>
                  <th scope="col">Colors</th>
                  <th scope="col">First pick</th>
                  <th scope="col" className="center">
                    Picks
                  </th>
                  <th scope="col" className="center">
                    Status
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Replay</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((row) => (
                  <tr key={row.id} onClick={(event) => openRow(row, event)}>
                    <td>{row.started_at ? formatDateTime(row.started_at) : '—'}</td>
                    <td>
                      {row.format_label}
                      {row.kind === 'bot' ? <span className="replay-vs"> · bots</span> : null}
                    </td>
                    <td>
                      <ColorPips colors={row.colors} />
                    </td>
                    <td>{row.first_pick?.name ?? '—'}</td>
                    <td className="center">{row.picks}</td>
                    <td className="center">
                      <Badge tone={row.completed_at ? 'win' : 'neutral'}>{row.completed_at ? 'Complete' : 'Incomplete'}</Badge>
                    </td>
                    <td>
                      <a className="replay-link" href={draftReplayRouteHash(row.id, { returnHash: REPLAY_ROUTE_HASH })}>
                        Replay draft
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Section>
  );
}
