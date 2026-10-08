/**
 * Replay reducer entry point (docs/REPLAY_FORMAT.md §3): the per-event reducer
 * plus a keyframed timeline so seeking anywhere in a long game stays instant.
 */
import { applyEvent, createInitialState } from './applyEvent';
import type { BoardState } from './boardState';
import type { CardKey, ObjId, ReplayEvent, ReplayStream, ReplayTurn } from './types';

export { applyEvent, createInitialState } from './applyEvent';
export type { BoardState, ObjectState, SeatState, StackItem } from './boardState';

/**
 * Extra keyframe after this many events without one, so a seek inside a long
 * turn replays at most this many events. States share structure, so a
 * keyframe costs little more than its changed entries.
 */
export const MAX_EVENTS_BETWEEN_KEYFRAMES = 32;

export interface Keyframe {
  /** Index into `events` of the last applied event; -1 = initial state. */
  index: number;
  state: BoardState;
}

export interface ReplayTimeline {
  readonly stream: ReplayStream;
  readonly events: readonly ReplayEvent[];
  readonly initial: BoardState;
  /** Sorted by index; the first is always the initial state (index -1). */
  readonly keyframes: readonly Keyframe[];
  readonly final: BoardState;
  readonly hindsight: ReadonlyMap<ObjId, CardKey>;
  /** Last stateAt result, so stepping forward costs one applyEvent. */
  memo: Keyframe;
}

function cardOfEvent(event: ReplayEvent): { obj: ObjId; card: CardKey } | null {
  switch (event.kind) {
    case 'move':
    case 'reveal':
      return event.card ? { obj: event.obj, card: event.card } : null;
    case 'stack_push':
      return event.obj && event.card ? { obj: event.obj, card: event.card } : null;
    default:
      return null;
  }
}

/**
 * Recorded streams keep one object id per card for the whole game, so the
 * first identity an object ever shows is what it was all along (an opponent
 * card drawn on turn 3 and cast on turn 6). Reconstructed ids are synthetic
 * picks among same-named cards, so they get no hindsight.
 */
export function computeHindsight(stream: ReplayStream): Map<ObjId, CardKey> {
  const known = new Map<ObjId, CardKey>();
  if (stream.fidelity !== 'recorded') {
    return known;
  }
  for (const event of stream.events) {
    const found = cardOfEvent(event);
    if (found && !known.has(found.obj)) {
      known.set(found.obj, found.card);
    }
  }
  return known;
}

export function buildTimeline(stream: ReplayStream): ReplayTimeline {
  const hindsight = computeHindsight(stream);
  const initial = createInitialState(stream, hindsight);
  const keyframes: Keyframe[] = [{ index: -1, state: initial }];
  let state = initial;
  let sinceKeyframe = 0;
  stream.events.forEach((event, index) => {
    state = applyEvent(state, event);
    sinceKeyframe += 1;
    if (event.kind === 'turn' || sinceKeyframe >= MAX_EVENTS_BETWEEN_KEYFRAMES) {
      keyframes.push({ index, state });
      sinceKeyframe = 0;
    }
  });
  return {
    stream,
    events: stream.events,
    initial,
    keyframes,
    final: state,
    hindsight,
    memo: { index: -1, state: initial },
  };
}

/** Index of the last event whose seq <= `seq`; -1 when `seq` precedes every event. */
export function indexAtSeq(events: readonly ReplayEvent[], seq: number): number {
  let lo = 0;
  let hi = events.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].seq <= seq) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function keyframeAtOrBefore(keyframes: readonly Keyframe[], index: number): Keyframe {
  let lo = 0;
  let hi = keyframes.length - 1;
  let found = keyframes[0];
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].index <= index) {
      found = keyframes[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Board state after every event with seq <= `seq` has been applied. */
export function stateAt(timeline: ReplayTimeline, seq: number): BoardState {
  const index = indexAtSeq(timeline.events, seq);
  const memo = timeline.memo;
  if (memo.index === index) {
    return memo.state;
  }
  const keyframe = keyframeAtOrBefore(timeline.keyframes, index);
  const base = memo.index <= index && memo.index >= keyframe.index ? memo : keyframe;
  let state = base.state;
  for (let i = base.index + 1; i <= index; i += 1) {
    state = applyEvent(state, timeline.events[i]);
  }
  timeline.memo = { index, state };
  return state;
}

/** The turn containing `seq`, or null before the first turn. */
export function turnAtSeq(turns: readonly ReplayTurn[], seq: number): ReplayTurn | null {
  let found: ReplayTurn | null = null;
  for (const turn of turns) {
    if (turn.first_seq <= seq) found = turn;
    else break;
  }
  return found;
}
