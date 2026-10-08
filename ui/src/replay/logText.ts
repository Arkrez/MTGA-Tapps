/**
 * Action-log helpers (pure): which events become rows, turn headers, the
 * actor of a row, card-name segments with their bracket decoration removed,
 * and clock formatting.
 */
import type { ReplayEvent, ReplayLogSegment, ReplayStream } from './types';

export type LogActor = 'player' | 'opponent' | 'system';

export interface LogTurnHeader {
  type: 'turn';
  key: string;
  turn: number | null;
  seat: number | null;
  seq: number;
}

export interface LogEventRow {
  type: 'event';
  key: string;
  seq: number;
  t: number;
  actor: LogActor;
  parts: LogPart[];
}

export type LogItem = LogTurnHeader | LogEventRow;

export type LogPart =
  | { kind: 'text'; text: string }
  | { kind: 'card'; name: string; text: string; meta: string | null };

const CLOCK_PREFIX = /^\s*\[\d+(?::\d{1,2}){1,2}\]\s*/;

export function stripClock(text: string): string {
  return text.replace(CLOCK_PREFIX, '');
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function seatOf(event: ReplayEvent): number | null {
  switch (event.kind) {
    case 'move':
      return event.controller ?? event.owner;
    case 'stack_push':
      return event.controller;
    case 'life':
    case 'mulligan':
    case 'attack':
    case 'block':
    case 'scry':
    case 'shuffle':
      return event.seat;
    case 'turn':
      return event.active_seat;
    default:
      return null;
  }
}

export function eventActor(event: ReplayEvent, playerSeat: number): LogActor {
  const text = event.log?.text ? stripClock(event.log.text) : '';
  if (/^You\b/.test(text)) return 'player';
  if (/^Opponent\b/.test(text)) return 'opponent';
  const seat = seatOf(event);
  if (seat === null) return 'system';
  return seat === playerSeat ? 'player' : 'opponent';
}

function isCard(segment: ReplayLogSegment): segment is Extract<ReplayLogSegment, { card_name: string }> {
  return 'card_name' in segment && typeof segment.card_name === 'string';
}

/** Card segments lose the `[Name (Type P/T)]` brackets; the suffix becomes `meta`. */
export function logParts(segments: readonly ReplayLogSegment[]): LogPart[] {
  const texts = segments.map((segment) => (isCard(segment) ? null : segment.text));
  if (texts.length && texts[0] !== null) texts[0] = stripClock(texts[0]);
  const metas = new Map<number, string | null>();
  segments.forEach((segment, index) => {
    if (!isCard(segment)) return;
    const before = index > 0 ? texts[index - 1] : null;
    const after = index + 1 < segments.length ? texts[index + 1] : null;
    let meta: string | null = null;
    if (before !== null && after !== null && before.endsWith('[')) {
      const closing = /^\s*(?:\(([^()]*)\))?\]/.exec(after);
      if (closing) {
        texts[index - 1] = before.slice(0, -1);
        texts[index + 1] = after.slice(closing[0].length);
        meta = closing[1]?.trim() || null;
      }
    }
    metas.set(index, meta);
  });
  const out: LogPart[] = [];
  segments.forEach((segment, index) => {
    if (isCard(segment)) {
      out.push({ kind: 'card', name: segment.card_name, text: segment.text || segment.card_name, meta: metas.get(index) ?? null });
    } else if (texts[index]) {
      out.push({ kind: 'text', text: texts[index] as string });
    }
  });
  return out;
}

/** Turn headers plus one row per logged event, in stream order. */
export function buildLogItems(stream: ReplayStream): LogItem[] {
  const items: LogItem[] = [];
  let headerFor: number | null | undefined;
  for (const event of stream.events) {
    if (event.kind === 'turn') {
      items.push({ type: 'turn', key: `turn:${event.seq}`, turn: event.turn, seat: event.active_seat, seq: event.seq });
      headerFor = event.turn;
      continue;
    }
    if (!event.log || !event.log.text) continue;
    if (headerFor === undefined) {
      items.push({ type: 'turn', key: 'pregame', turn: null, seat: null, seq: event.seq });
      headerFor = null;
    }
    const segments = event.log.segments?.length ? event.log.segments : [{ text: event.log.text }];
    items.push({
      type: 'event',
      key: `event:${event.seq}`,
      seq: event.seq,
      t: event.t,
      actor: eventActor(event, stream.player_seat),
      parts: logParts(segments),
    });
  }
  return items;
}

/** Index of the last item whose seq <= `seq` (items are seq-ordered); -1 if none. */
export function activeItemIndex(items: readonly LogItem[], seq: number): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].seq <= seq) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** "Phase_Combat" / "Step_DeclareAttack" -> "Combat" / "Declare attack". */
export function phaseLabel(value: string | null): string | null {
  if (!value) return null;
  const words = value
    .replace(/^(Phase|Step)_/, '')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();
  if (!words) return null;
  return words[0].toUpperCase() + words.slice(1);
}
