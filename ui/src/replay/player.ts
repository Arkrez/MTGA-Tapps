/**
 * Playback clock (docs/REPLAY_FORMAT.md §3). Owns "which event is showing"
 * and the play/pause timer; React subscribes and derives the board from
 * `stateAt(timeline, clock.seq)`. Time sources are injectable for tests.
 */
import { indexAtSeq, turnAtSeq } from './reducer';
import type { ReplayTimeline } from './reducer';

export type PlaybackSpeed = 0.5 | 1 | 2 | 4 | 8;
export const PLAYBACK_SPEEDS: readonly PlaybackSpeed[] = [0.5, 1, 2, 4, 8];
export type Pacing = 'paced' | 'realtime';
export type CancelTimer = () => void;
export type ScheduleFn = (callback: () => void, ms: number) => CancelTimer;

export interface PlaybackClockOptions {
  now?: () => number;
  schedule?: ScheduleFn;
  speed?: PlaybackSpeed;
  pacing?: Pacing;
  /** Initial position; defaults to the first event. */
  seq?: number;
}

export interface PlaybackSnapshot {
  seq: number;
  index: number;
  playing: boolean;
  speed: PlaybackSpeed;
  pacing: Pacing;
  atEnd: boolean;
  /** Turn number containing `seq`, or null before turn 1. */
  turn: number | null;
}

export type PlaybackListener = (snapshot: PlaybackSnapshot) => void;

export const PACED_MIN_MS = 600;
export const PACED_MAX_MS = 2500;
export const PACED_MS_PER_SECOND = 250;

/** How long the event before a `gapSeconds` gap stays on screen. */
export function holdMs(gapSeconds: number, pacing: Pacing, speed: PlaybackSpeed): number {
  const gap = Number.isFinite(gapSeconds) ? Math.max(0, gapSeconds) : 0;
  if (pacing === 'realtime') {
    return (gap * 1000) / speed;
  }
  return Math.max(PACED_MIN_MS, Math.min(PACED_MAX_MS, gap * PACED_MS_PER_SECOND)) / speed;
}

const defaultSchedule: ScheduleFn = (callback, ms) => {
  const id = setTimeout(callback, ms);
  return () => clearTimeout(id);
};

const defaultNow = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

export class PlaybackClock {
  private readonly timeline: ReplayTimeline;
  private readonly now: () => number;
  private readonly schedule: ScheduleFn;
  private readonly listeners = new Set<PlaybackListener>();
  private index: number;
  private playing = false;
  private speed: PlaybackSpeed;
  private pacing: Pacing;
  private cancelTimer: CancelTimer | null = null;
  private dueAt = 0;
  private disposed = false;
  private current: PlaybackSnapshot;

  /** Index of the first turn header: where "play from the start" begins. */
  private readonly startIndex: number;

  constructor(timeline: ReplayTimeline, opts: PlaybackClockOptions = {}) {
    this.timeline = timeline;
    const firstTurn = timeline.events.findIndex((event) => event.kind === 'turn');
    this.startIndex = firstTurn < 0 ? 0 : firstTurn;
    this.now = opts.now ?? defaultNow;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.speed = opts.speed ?? 1;
    this.pacing = opts.pacing ?? 'paced';
    this.index = this.clampIndex(opts.seq === undefined ? 0 : indexAtSeq(timeline.events, opts.seq));
    this.current = this.makeSnapshot();
  }

  /** Returns an unsubscribe function. Compatible with React's useSyncExternalStore. */
  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stable until the next change, for useSyncExternalStore's getSnapshot. */
  get snapshot(): PlaybackSnapshot {
    return this.current;
  }

  get seq(): number {
    return this.timeline.events[this.index]?.seq ?? -1;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Subscribers still attached (leak checks in tests). */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /** First navigable event: the first turn header, with the opening hands already dealt. */
  get firstSeq(): number {
    return this.timeline.events[this.startIndex]?.seq ?? -1;
  }

  /** Same as `firstSeq` (the name the ending screen's Watch again uses). */
  get startSeq(): number {
    return this.firstSeq;
  }

  /** Index of the first navigable event (see `firstSeq`). */
  get firstIndex(): number {
    return this.startIndex;
  }

  get lastSeq(): number {
    return this.timeline.events[this.timeline.events.length - 1]?.seq ?? -1;
  }

  play(): void {
    if (this.disposed || this.playing || !this.timeline.events.length) return;
    if (this.atEnd()) this.index = this.startIndex;
    this.playing = true;
    this.scheduleNext(0);
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.stopTimer();
    this.playing = false;
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: PlaybackSpeed): void {
    if (speed === this.speed || !PLAYBACK_SPEEDS.includes(speed)) return;
    this.speed = speed;
    this.restartTimer();
    this.emit();
  }

  setPacing(pacing: Pacing): void {
    if (pacing === this.pacing) return;
    this.pacing = pacing;
    this.restartTimer();
    this.emit();
  }

  /** Steps one event and pauses (frame-by-frame). */
  step(delta: 1 | -1): void {
    const target = this.clampIndex(this.index + delta);
    if (target === this.index && !this.playing) return;
    this.stopTimer();
    this.playing = false;
    this.index = target;
    this.emit();
  }

  seek(seq: number): void {
    this.moveTo(this.clampIndex(indexAtSeq(this.timeline.events, seq)));
  }

  seekTurn(turn: number): void {
    const found = this.timeline.stream.turns.find((t) => t.turn === turn);
    if (found) this.seek(found.first_seq);
  }

  /** Start of the next turn, or the end of the game after the last turn. */
  nextTurn(): void {
    const seq = this.seq;
    const next = this.timeline.stream.turns.find((t) => t.first_seq > seq);
    this.seek(next ? next.first_seq : this.lastSeq);
  }

  /** Start of the current turn, or of the previous turn when already there. */
  prevTurn(): void {
    const turns = this.timeline.stream.turns;
    const seq = this.seq;
    const current = turnAtSeq(turns, seq);
    if (current && current.first_seq < seq) {
      this.seek(current.first_seq);
      return;
    }
    const at = current ? turns.indexOf(current) : -1;
    this.seek(at > 0 ? turns[at - 1].first_seq : this.firstSeq);
  }

  dispose(): void {
    this.stopTimer();
    this.playing = false;
    this.disposed = true;
    this.listeners.clear();
  }

  private moveTo(index: number): void {
    if (index === this.index) return;
    this.index = index;
    if (this.playing) {
      if (this.atEnd()) {
        this.stopTimer();
        this.playing = false;
      } else {
        this.restartTimer();
      }
    }
    this.emit();
  }

  /** Playback never goes before the first turn header: the opening deal is applied, not shown. */
  private clampIndex(index: number): number {
    const last = this.timeline.events.length - 1;
    return Math.max(Math.min(index, last), last < 0 ? -1 : this.startIndex);
  }

  private atEnd(): boolean {
    return this.index >= this.timeline.events.length - 1;
  }

  private gapAfter(index: number): number {
    const events = this.timeline.events;
    const here = events[index];
    const next = events[index + 1];
    return here && next ? next.t - here.t : 0;
  }

  private scheduleNext(lateness: number): void {
    if (!this.playing || this.disposed || this.atEnd()) return;
    const hold = Math.max(0, holdMs(this.gapAfter(this.index), this.pacing, this.speed) - lateness);
    this.dueAt = this.now() + hold;
    this.cancelTimer = this.schedule(() => this.tick(), hold);
  }

  private tick(): void {
    this.cancelTimer = null;
    if (!this.playing || this.disposed) return;
    const lateness = Math.max(0, this.now() - this.dueAt);
    this.index = this.clampIndex(this.index + 1);
    if (this.atEnd()) {
      this.playing = false;
    } else {
      this.scheduleNext(lateness);
    }
    this.emit();
  }

  private restartTimer(): void {
    if (!this.playing) return;
    this.stopTimer();
    this.scheduleNext(0);
  }

  private stopTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private makeSnapshot(): PlaybackSnapshot {
    const seq = this.seq;
    return {
      seq,
      index: this.index,
      playing: this.playing,
      speed: this.speed,
      pacing: this.pacing,
      atEnd: this.atEnd(),
      turn: turnAtSeq(this.timeline.stream.turns, seq)?.turn ?? null,
    };
  }

  private emit(): void {
    if (this.disposed) return;
    this.current = this.makeSnapshot();
    for (const listener of [...this.listeners]) listener(this.current);
  }
}
