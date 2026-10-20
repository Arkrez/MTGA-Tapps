/**
 * `#/replay/draft/<id>`: fetches the draft stream and shows loading and
 * error states; the loaded page lives in DraftReplayViewer. Lazy-loaded by App.
 */
import { useEffect, useState } from 'react';
import { fetchDraftReplay } from '../../api';
import { pageTitle } from '../../branding';
import { REPLAY_ROUTE_HASH } from '../../routes';
import { useDocumentTitle } from '../hooks/useViewport';
import { DraftReplayViewer } from './DraftReplayViewer';
import type { DraftStream } from './types';
import '../replay.css';
import '../replay-controls.css';
import './draft.css';

export interface DraftReplayPageProps {
  draftId: string;
  step: string | null;
  returnHash: string | null;
}

type LoadState = { status: 'loading' } | { status: 'ready'; stream: DraftStream } | { status: 'error'; message: string };

export function DraftReplayPage({ draftId, step, returnHash }: DraftReplayPageProps) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  useDocumentTitle(pageTitle('Draft Replay'));

  useEffect(() => {
    const controller = new AbortController();
    fetchDraftReplay(draftId, controller.signal).then(
      (stream) => setLoad({ status: 'ready', stream }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => controller.abort();
  }, [draftId]);

  if (load.status === 'ready') {
    return <DraftReplayViewer stream={load.stream} step={step} returnHash={returnHash} />;
  }
  return (
    <div className="replay-page replay-page-state">
      {load.status === 'loading' ? (
        <p className="state-panel" role="status" aria-busy="true">
          Loading draft…
        </p>
      ) : (
        <div className="state-panel error-state" role="alert">
          <strong>Could not load the draft.</strong>
          <p>{load.message}</p>
          <a className="replay-back" href={returnHash ?? REPLAY_ROUTE_HASH}>
            ← Back
          </a>
        </div>
      )}
    </div>
  );
}

export default DraftReplayPage;
