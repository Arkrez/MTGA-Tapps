/**
 * `#/replay/<id>`: fetches the replay stream and shows loading, unavailable
 * and error states; the loaded page lives in ReplayViewer. Lazy-loaded by
 * App, so three.js stays out of the main bundle.
 */
import { useEffect, useState } from 'react';
import { ReplayUnavailableError, fetchReplay } from '../../api';
import { pageTitle } from '../../branding';
import { REPLAY_ROUTE_HASH } from '../../routes';
import { useDocumentTitle } from '../hooks/useViewport';
import { initialSeq } from '../scrub';
import type { ReplayStream } from '../types';
import { ReplayViewer } from './ReplayViewer';
import '../replay.css';
import '../replay-controls.css';

export interface ReplayPageProps {
  gameId: string;
  at: number | null;
  /** `game_events.id` from a timeline deep link (`?row=`); used when `at` is absent. */
  row?: number | null;
  returnHash: string | null;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; stream: ReplayStream }
  | { status: 'unavailable'; reason: string | null }
  | { status: 'error'; message: string };

export function ReplayPage({ gameId, at, row = null, returnHash }: ReplayPageProps) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  useDocumentTitle(pageTitle('Replay'));

  useEffect(() => {
    const controller = new AbortController();
    fetchReplay(gameId, controller.signal).then(
      (stream) => setLoad({ status: 'ready', stream }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ReplayUnavailableError) setLoad({ status: 'unavailable', reason: error.reason });
        else setLoad({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => controller.abort();
  }, [gameId]);

  const back = returnHash ?? REPLAY_ROUTE_HASH;
  if (load.status === 'ready') {
    return <ReplayViewer stream={load.stream} gameId={gameId} at={initialSeq(load.stream, at, row)} returnHash={returnHash} />;
  }
  return (
    <div className="replay-page replay-page-state">
      {load.status === 'loading' ? (
        <p className="state-panel" role="status" aria-busy="true">
          Loading replay…
        </p>
      ) : load.status === 'unavailable' ? (
        <div className="state-panel" role="alert">
          <strong>This game has no replay.</strong>
          <p>{load.reason ? `Reason: ${load.reason}.` : 'No events were recorded for it.'}</p>
          <a className="replay-back" href={back}>
            ← Back
          </a>
        </div>
      ) : (
        <div className="state-panel error-state" role="alert">
          <strong>Could not load the replay.</strong>
          <p>{load.message}</p>
          <a className="replay-back" href={back}>
            ← Back
          </a>
        </div>
      )}
    </div>
  );
}

export default ReplayPage;
