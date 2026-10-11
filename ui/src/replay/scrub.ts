/**
 * Scrub-bar geometry (pure): one segment per turn, sized by event count so
 * the playhead advances evenly in paced playback, plus position <-> event
 * index conversion.
 */
import { indexAtSeq } from './reducer';
import type { ReplayStream } from './types';

export interface ScrubSegment {
  key: string;
  turn: number | null;
  seat: number | null;
  /** Fractions of the bar, 0..1. */
  start: number;
  end: number;
  firstSeq: number;
}

export function fractionOfIndex(index: number, total: number): number {
  return total > 1 ? Math.min(1, Math.max(0, index / (total - 1))) : 0;
}

export function indexAtFraction(fraction: number, total: number): number {
  if (total <= 1) return 0;
  return Math.round(Math.min(1, Math.max(0, fraction)) * (total - 1));
}

/**
 * One segment per turn over the navigable range, which starts at the first
 * turn header (`openingEndIndex`): the opening deal before it is not on the
 * bar. A stream without turn headers is one pre-game segment.
 */
export function scrubSegments(stream: ReplayStream): ScrubSegment[] {
  const events = stream.events;
  const total = events.length;
  if (!total) return [];
  const first = openingEndIndex(events);
  const span = Math.max(1, total - first);
  if (!stream.turns.length) {
    return [{ key: 'pregame', turn: null, seat: null, start: 0, end: 1, firstSeq: events[first].seq }];
  }
  const starts = stream.turns.map((turn) => Math.max(first, indexAtSeq(events, turn.first_seq)));
  const segments: ScrubSegment[] = stream.turns.map((turn, i) => ({
    key: `turn:${turn.turn}:${i}`,
    turn: turn.turn,
    seat: turn.seat,
    start: 0,
    end: 0,
    firstSeq: turn.first_seq,
  }));
  segments.forEach((segment, i) => {
    const from = starts[i] - first;
    const to = (i + 1 < segments.length ? starts[i + 1] : total) - first;
    segment.start = from / span;
    segment.end = to / span;
  });
  return segments;
}

/** Keys of turn segments whose tick label fits at least `minPx` after the previous shown one. */
export function visibleTurnLabels(segments: readonly ScrubSegment[], widthPx: number, minPx = 30): Set<string> {
  const shown = new Set<string>();
  let last = -Infinity;
  for (const segment of segments) {
    if (segment.turn === null) continue;
    const x = segment.start * widthPx;
    if (x - last >= minPx) {
      shown.add(segment.key);
      last = x;
    }
  }
  return shown;
}

/**
 * Index of the first turn header: the opening deal and mulligans before it
 * are applied in one go, so playback starts with the kept hands already in
 * place. 0 when the stream has no turn events.
 */
export function openingEndIndex(events: ReplayStream['events']): number {
  const index = events.findIndex((event) => event.kind === 'turn');
  return index < 0 ? 0 : index;
}

/** Seq of that first turn header (null for an empty stream). */
export function openingEndSeq(stream: ReplayStream): number | null {
  return stream.events[openingEndIndex(stream.events)]?.seq ?? null;
}

/**
 * Where a deep link opens: `?at=` (an event seq) wins; otherwise `?row=` (a
 * `game_events.id`) opens at the first event derived from that row; with
 * neither, or an unknown row, the replay starts at turn 1 with the opening
 * hands dealt (`openingEndSeq`).
 */
export function initialSeq(stream: ReplayStream, at: number | null, row: number | null): number | null {
  if (at !== null) return at;
  if (row !== null) {
    const found = stream.events.find((event) => event.row_id === row);
    if (found) return found.seq;
  }
  return openingEndSeq(stream);
}
