/**
 * Replay framework: the registry of replay kinds. Each kind owns a route
 * segment under `#/replay/` and a section of the Replay list page; adding a
 * kind (sealed pools, Bo3 matches, …) means adding an entry here, a stream
 * endpoint and a lazy-loaded page (docs/DRAFT_REPLAY.md §3).
 */

export type ReplayKindId = 'game' | 'draft';

export interface ReplayKind {
  id: ReplayKindId;
  /** Route segment before the id: `#/replay/<segment><id>`. Empty for games (the original routes). */
  segment: string;
  /** Replay list section id (also the sidebar anchor). */
  listSection: string;
  /** Sidebar / heading label for the list section. */
  label: string;
}

export const REPLAY_KINDS: readonly ReplayKind[] = [
  { id: 'game', segment: '', listSection: 'replay-games', label: 'Recent games' },
  { id: 'draft', segment: 'draft/', listSection: 'replay-drafts', label: 'Drafts' },
];

export function replayKind(id: ReplayKindId): ReplayKind {
  return REPLAY_KINDS.find((kind) => kind.id === id) ?? REPLAY_KINDS[0];
}

/** The kind whose segment starts this route remainder (`draft/abc` → draft); games otherwise. */
export function kindForRoute(route: string): { kind: ReplayKind; rest: string } {
  for (const kind of REPLAY_KINDS) {
    if (kind.segment && route.startsWith(kind.segment)) {
      return { kind, rest: route.slice(kind.segment.length) };
    }
  }
  return { kind: replayKind('game'), rest: route };
}
