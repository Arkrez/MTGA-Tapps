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

export function scrubSegments(stream: ReplayStream): ScrubSegment[] {
  const events = stream.events;
  const total = events.length;
  if (!total) return [];
  const segments: ScrubSegment[] = [];
  const starts = stream.turns.map((turn) => Math.max(0, indexAtSeq(events, turn.first_seq)));
  if (!stream.turns.length || starts[0] > 0) {
    segments.push({ key: 'pregame', turn: null, seat: null, start: 0, end: 0, firstSeq: events[0].seq });
  }
  stream.turns.forEach((turn, i) => {
    segments.push({ key: `turn:${turn.turn}:${i}`, turn: turn.turn, seat: turn.seat, start: 0, end: 0, firstSeq: turn.first_seq });
  });
  const firstIndex = (segment: ScrubSegment, i: number) =>
    segment.turn === null ? 0 : starts[segments[0].turn === null ? i - 1 : i];
  segments.forEach((segment, i) => {
    const from = firstIndex(segment, i);
    const to = i + 1 < segments.length ? firstIndex(segments[i + 1], i + 1) : total;
    segment.start = from / total;
    segment.end = to / total;
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
 * Where a deep link opens: `?at=` (an event seq) wins; otherwise `?row=` (a
 * `game_events.id`) opens at the first event derived from that row; with
 * neither, or an unknown row, the replay starts at the beginning (null).
 */
export function initialSeq(stream: ReplayStream, at: number | null, row: number | null): number | null {
  if (at !== null) return at;
  if (row === null) return null;
  const found = stream.events.find((event) => event.row_id === row);
  return found ? found.seq : null;
}
