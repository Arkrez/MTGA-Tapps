/** Viewport helpers for the replay page. */
import { useEffect, useSyncExternalStore } from 'react';

export const REPLAY_MIN_WIDTH = 900;

function subscribe(listener: () => void): () => void {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

/** True below the 900 px replay minimum (the page shows a notice instead of the canvas). */
export function useNarrowViewport(): boolean {
  return useSyncExternalStore(subscribe, () => window.innerWidth < REPLAY_MIN_WIDTH, () => false);
}

/** Sets document.title while mounted and restores the previous title afterwards. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
