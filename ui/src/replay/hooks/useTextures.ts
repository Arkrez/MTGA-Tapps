/**
 * Texture store lifetime and load priorities: cards on the table load first,
 * then cards that appear in the current and next turn, then the rest of the
 * game's cards in the background so playback rarely waits on an image.
 */
import { useEffect, useMemo } from 'react';
import type { Layout } from '../layout';
import type { ReplayTimeline } from '../reducer';
import { TextureStore, VISIBLE_PRIORITY } from '../scene/textureStore';
import type { CardKey, ReplayEvent, ReplayStream } from '../types';

export function useTextureStore(stream: ReplayStream): TextureStore {
  const store = useMemo(() => new TextureStore(stream.cards), [stream.cards]);
  useEffect(() => {
    store.retain();
    return () => store.release();
  }, [store]);
  return store;
}

function cardOf(event: ReplayEvent): CardKey | null {
  switch (event.kind) {
    case 'move':
    case 'stack_push':
      return event.card;
    case 'reveal':
    case 'identity':
      return event.card;
    default:
      return null;
  }
}

/** Card keys referenced by each turn's events (turn 0 = pre-game). */
export function cardsByTurn(stream: ReplayStream): Map<number, Set<CardKey>> {
  const byTurn = new Map<number, Set<CardKey>>();
  for (const event of stream.events) {
    const key = cardOf(event);
    if (!key) continue;
    let set = byTurn.get(event.turn);
    if (!set) {
      set = new Set();
      byTurn.set(event.turn, set);
    }
    set.add(key);
  }
  return byTurn;
}

export function texturePriorities(
  stream: ReplayStream,
  byTurn: ReadonlyMap<number, ReadonlySet<CardKey>>,
  layout: Layout,
  turn: number,
): Map<CardKey, number> {
  const priorities = new Map<CardKey, number>();
  for (const key of Object.keys(stream.cards)) priorities.set(key, 1);
  for (const t of [turn, turn + 1]) {
    for (const key of byTurn.get(t) ?? []) priorities.set(key, 2);
  }
  for (const placement of layout.cards) {
    if (placement.card && placement.faceUp) priorities.set(placement.card, VISIBLE_PRIORITY);
  }
  return priorities;
}

export function useTexturePriorities(store: TextureStore, timeline: ReplayTimeline, layout: Layout, turn: number): void {
  const byTurn = useMemo(() => cardsByTurn(timeline.stream), [timeline]);
  useEffect(() => {
    store.request(texturePriorities(timeline.stream, byTurn, layout, turn));
  }, [store, timeline, byTurn, layout, turn]);
}
