/**
 * Video export plan (pure): which event each output frame shows. Frames
 * follow the player's own pacing (player.holdMs) at the chosen speed, so the
 * video plays exactly like the viewer would, then holds the final frame (the
 * ending screen) for a moment.
 */
import { holdMs } from '../player';
import type { Pacing, PlaybackSpeed } from '../player';
import type { ReplayEvent, ReplayStream } from '../types';

export const EXPORT_FPS = 30;
/** Seconds the last frame stays on screen. */
export const EXPORT_TAIL_SECONDS = 3;
/** Longest video produced (frames): twenty minutes at EXPORT_FPS. */
export const MAX_EXPORT_FRAMES = EXPORT_FPS * 60 * 20;

export interface VideoPlanOptions {
  speed: PlaybackSpeed;
  pacing: Pacing;
  fps?: number;
  /** First and last event index (inclusive); the whole game when omitted. */
  fromIndex?: number;
  toIndex?: number;
  tailSeconds?: number;
}

export interface VideoPlan {
  fps: number;
  /** Event index shown by each frame, in order. */
  frames: Int32Array;
  /** Video length in seconds. */
  seconds: number;
  fromIndex: number;
  toIndex: number;
  /** True when MAX_EXPORT_FRAMES cut the plan short. */
  truncated: boolean;
}

export function buildVideoPlan(events: readonly ReplayEvent[], opts: VideoPlanOptions): VideoPlan {
  const fps = opts.fps ?? EXPORT_FPS;
  const last = events.length - 1;
  const clamp = (i: number) => Math.max(0, Math.min(last, Math.round(i)));
  if (last < 0) return { fps, frames: new Int32Array(0), seconds: 0, fromIndex: 0, toIndex: 0, truncated: false };
  const fromIndex = clamp(opts.fromIndex ?? 0);
  const toIndex = Math.max(fromIndex, clamp(opts.toIndex ?? last));
  const tail = opts.tailSeconds ?? EXPORT_TAIL_SECONDS;
  const frames: number[] = [];
  let carry = 0;
  let truncated = false;
  for (let i = fromIndex; i <= toIndex; i += 1) {
    let count: number;
    if (i === toIndex) {
      count = Math.max(1, Math.round(tail * fps));
    } else {
      const gap = Math.max(0, events[i + 1].t - events[i].t);
      const exact = (holdMs(gap, opts.pacing, opts.speed) / 1000) * fps + carry;
      count = Math.floor(exact);
      carry = exact - count;
    }
    for (let k = 0; k < count; k += 1) {
      if (frames.length >= MAX_EXPORT_FRAMES) {
        truncated = true;
        break;
      }
      frames.push(i);
    }
    if (truncated) break;
  }
  return { fps, frames: Int32Array.from(frames), seconds: frames.length / fps, fromIndex, toIndex, truncated };
}

/** Rough length of the planned video, for the dialog, in seconds. */
export function estimateVideoSeconds(events: readonly ReplayEvent[], opts: VideoPlanOptions): number {
  return buildVideoPlan(events, opts).seconds;
}

/** A safe download name: replay-<opponent or deck>-<date>.mp4. */
export function exportFileName(stream: Pick<ReplayStream, 'seats' | 'player_seat' | 'game'>): string {
  const opponent = Object.entries(stream.seats).find(([seat]) => Number(seat) !== stream.player_seat)?.[1];
  const who = opponent?.name || opponent?.deck_name || 'game';
  const date = (stream.game.started_at ?? '').slice(0, 10) || 'replay';
  const slug = who
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `replay-${slug || 'game'}-${date}.mp4`;
}
