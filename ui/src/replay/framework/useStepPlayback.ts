/**
 * Replay framework: playback state for a step timeline (index, play/pause,
 * speed) plus the shared keyboard shortcuts. Any replay kind with discrete
 * steps uses this instead of writing its own clock.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isTypingTarget } from '../hooks/useReplayKeyboard';
import {
  STEP_SPEEDS,
  clampIndex,
  nextGroupStart,
  prevGroupStart,
  stepHoldMs,
  type StepSpeed,
  type TimelineStep,
} from './timeline';

export interface StepPlayback {
  index: number;
  playing: boolean;
  speed: StepSpeed;
  count: number;
  seek: (index: number) => void;
  step: (delta: number) => void;
  nextGroup: () => void;
  prevGroup: () => void;
  toggle: () => void;
  pause: () => void;
  setSpeed: (speed: StepSpeed) => void;
}

export interface StepPlaybackOptions {
  initialIndex?: number;
  /** How long one step shows at 1× while playing. */
  holdMs?: number;
}

export function useStepPlayback(steps: readonly TimelineStep[], opts: StepPlaybackOptions = {}): StepPlayback {
  const count = steps.length;
  const [index, setIndex] = useState(() => clampIndex(opts.initialIndex ?? 0, count));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<StepSpeed>(1);
  const holdMs = opts.holdMs ?? 1800;

  const seek = useCallback((next: number) => setIndex(clampIndex(next, count)), [count]);
  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      setIndex((current) => clampIndex(current + delta, count));
    },
    [count],
  );
  const nextGroup = useCallback(() => setIndex((current) => nextGroupStart(steps, current)), [steps]);
  const prevGroup = useCallback(() => setIndex((current) => prevGroupStart(steps, current)), [steps]);
  const pause = useCallback(() => setPlaying(false), []);
  // Playback stops by itself on the last step.
  const running = playing && index < count - 1;
  const toggle = useCallback(() => {
    if (running) {
      setPlaying(false);
      return;
    }
    // Play from the start again once the end was reached.
    if (index >= count - 1) setIndex(0);
    setPlaying(true);
  }, [count, index, running]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setIndex((current) => clampIndex(current + 1, count)), stepHoldMs(holdMs, speed));
    return () => window.clearTimeout(timer);
  }, [count, holdMs, running, speed, index]);

  return useMemo(
    () => ({ index, playing: running, speed, count, seek, step, nextGroup, prevGroup, toggle, pause, setSpeed }),
    [count, index, nextGroup, pause, running, prevGroup, seek, speed, step, toggle],
  );
}

/** Returns true when the key was handled. */
export function handleStepKey(key: string, playback: StepPlayback): boolean {
  switch (key) {
    case ' ':
    case 'Spacebar':
      playback.toggle();
      return true;
    case 'ArrowRight':
      playback.step(1);
      return true;
    case 'ArrowLeft':
      playback.step(-1);
      return true;
    case 'j':
    case 'J':
      playback.pause();
      playback.prevGroup();
      return true;
    case 'k':
    case 'K':
      playback.pause();
      playback.nextGroup();
      return true;
    case 'Home':
      playback.pause();
      playback.seek(0);
      return true;
    case 'End':
      playback.pause();
      playback.seek(playback.count - 1);
      return true;
    case '[':
    case ']': {
      const at = STEP_SPEEDS.indexOf(playback.speed);
      const next = STEP_SPEEDS[clampIndex(at + (key === ']' ? 1 : -1), STEP_SPEEDS.length)];
      playback.setSpeed(next);
      return true;
    }
    default:
      return false;
  }
}

/** Page-wide shortcuts for a step replay; ignored while typing or with a modifier held. */
export function useStepKeyboard(playback: StepPlayback, extra?: (key: string) => boolean): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (handleStepKey(event.key, playback) || extra?.(event.key)) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [extra, playback]);
}
