/**
 * Replay framework: the pure step timeline every step-based replay kind
 * shares (docs/DRAFT_REPLAY.md §3). A kind turns its stream into ordered
 * `TimelineStep`s; groups (a draft's packs, later a game's turns) become the
 * scrub bar's segments and the J/K jumps. Nothing here knows about drafts.
 */

export interface TimelineStep {
  /** Stable id (used for React keys and `?step=` deep links). */
  key: string;
  /** Short label for the scrub tooltip and counters, e.g. "P1p3". */
  label: string;
  /** Segment this step belongs to, e.g. "Pack 1". */
  group: string;
}

export interface TimelineGroup {
  group: string;
  /** Index of the group's first step. */
  start: number;
  /** Index of the group's last step (inclusive). */
  end: number;
}

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(length - 1, Math.round(index)));
}

/** Consecutive runs of the same group, in step order. */
export function timelineGroups(steps: readonly TimelineStep[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  steps.forEach((step, index) => {
    const last = groups[groups.length - 1];
    if (last && last.group === step.group) last.end = index;
    else groups.push({ group: step.group, start: index, end: index });
  });
  return groups;
}

/** First step of the next group, or the last step when already in the final group. */
export function nextGroupStart(steps: readonly TimelineStep[], index: number): number {
  const groups = timelineGroups(steps);
  const next = groups.find((group) => group.start > index);
  return next ? next.start : clampIndex(steps.length - 1, steps.length);
}

/**
 * Start of the current group, or of the previous group when already at a
 * group's start (like a music player's back button).
 */
export function prevGroupStart(steps: readonly TimelineStep[], index: number): number {
  const groups = timelineGroups(steps);
  const current = groups.find((group) => group.start <= index && index <= group.end);
  if (!current) return 0;
  if (index > current.start) return current.start;
  const position = groups.indexOf(current);
  return position > 0 ? groups[position - 1].start : 0;
}

/** Index of the step with this key, or null. */
export function indexOfKey(steps: readonly TimelineStep[], key: string | null): number | null {
  if (!key) return null;
  const found = steps.findIndex((step) => step.key === key);
  return found >= 0 ? found : null;
}

export const STEP_SPEEDS = [0.5, 1, 2, 4] as const;
export type StepSpeed = (typeof STEP_SPEEDS)[number];

/** Milliseconds each step is shown while playing. */
export function stepHoldMs(baseMs: number, speed: StepSpeed): number {
  return Math.max(150, Math.round(baseMs / speed));
}
