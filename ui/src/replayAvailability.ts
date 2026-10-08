import type { ReplayAvailability } from './api';

export const RECONSTRUCTED_TITLE = 'Reconstructed from the event log (approximate board)';
export const RECORDED_TITLE = 'Watch replay';

/** Effective state: rows from an older server (no `replay` field) are
    treated as reconstructed, since every game with events can be rebuilt. */
export function replayState(availability?: ReplayAvailability | null): ReplayAvailability['state'] {
  return availability?.state ?? 'reconstructed';
}

export function replayStateLabel(availability?: ReplayAvailability | null): string {
  const state = replayState(availability);
  return state === 'recorded' ? 'Recorded' : state === 'unavailable' ? 'Unavailable' : 'Reconstructed';
}

export function replayStateTitle(availability?: ReplayAvailability | null): string {
  const state = replayState(availability);
  if (state === 'unavailable') {
    return availability?.reason ? `Replay unavailable: ${availability.reason}` : 'Replay unavailable';
  }
  return state === 'recorded' ? RECORDED_TITLE : RECONSTRUCTED_TITLE;
}
