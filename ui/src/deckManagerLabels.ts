import type { NativeDeckStatus } from './deckManagerApi';

/** The button label for reading Arena; the status text refers to it by name. */
export function loadLabel(native: NativeDeckStatus | null) {
  return native?.connected ? 'Refresh Arena decks' : 'Load Arena decks';
}
