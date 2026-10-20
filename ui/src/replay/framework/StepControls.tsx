/**
 * Replay framework: transport bar for a step timeline — a segmented scrub
 * bar (one segment per group, one tick per step) above the step/group/play
 * buttons, speed and counters. Styled with the game replay's transport
 * classes (replay-controls.css) so both kinds look alike.
 */
import type { PointerEvent } from 'react';
import { STEP_SPEEDS, timelineGroups, type StepSpeed, type TimelineStep } from './timeline';
import type { StepPlayback } from './useStepPlayback';

interface StepControlsProps {
  steps: readonly TimelineStep[];
  playback: StepPlayback;
  /** Button text for a group jump, e.g. "Pack". */
  groupNoun: string;
  /** Button text for one step, e.g. "Pick". */
  stepNoun: string;
  /** Marks a step on the scrub bar (e.g. a pack seen before). */
  isMarked?: (index: number) => boolean;
}

export function StepControls({ steps, playback, groupNoun, stepNoun, isMarked }: StepControlsProps) {
  const groups = timelineGroups(steps);
  const total = steps.length;
  const current = steps[playback.index];
  const position = (index: number) => (total <= 1 ? 0 : (index / (total - 1)) * 100);

  const seekFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || total === 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    playback.pause();
    playback.seek(Math.round(ratio * (total - 1)));
  };

  return (
    <div className="replay-controls step-controls">
      <div className="replay-scrub-labels" aria-hidden="true">
        {groups.map((group) => (
          <span key={group.group} style={{ left: `${position(group.start)}%` }}>
            {group.group}
          </span>
        ))}
      </div>
      <div
        className="replay-scrub-track"
        role="slider"
        tabIndex={0}
        aria-label={`${stepNoun} timeline`}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={playback.index + 1}
        aria-valuetext={current?.label}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          seekFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons & 1) seekFromPointer(event);
        }}
      >
        {groups.map((group, n) => (
          <div
            key={group.group}
            className={`replay-scrub-segment step-seg-${n % 3}${
              playback.index >= group.start && playback.index <= group.end ? ' replay-seg-current' : ''
            }`}
            style={{ left: `${position(group.start)}%`, width: `${Math.max(0.5, position(group.end) - position(group.start))}%` }}
          />
        ))}
        {isMarked &&
          steps.map((step, index) =>
            isMarked(index) ? (
              <span key={step.key} className="step-scrub-mark" style={{ left: `${position(index)}%` }} title={step.label} />
            ) : null,
          )}
        <div className="replay-scrub-head" style={{ left: `${position(playback.index)}%` }} />
      </div>
      <div className="replay-controls-row">
        <div className="replay-transport" role="group" aria-label="Playback">
          <button type="button" className="replay-btn" onClick={() => { playback.pause(); playback.prevGroup(); }} title={`Previous ${groupNoun.toLowerCase()} (J)`}>
            <span className="replay-btn-icon" aria-hidden="true">⏮</span>
            {groupNoun}
          </button>
          <button type="button" className="replay-btn" onClick={() => playback.step(-1)} title={`Previous ${stepNoun.toLowerCase()} (←)`} disabled={playback.index === 0}>
            <span className="replay-btn-icon" aria-hidden="true">◀</span>
            {stepNoun}
          </button>
          <button
            type="button"
            className="replay-btn replay-btn-play"
            onClick={playback.toggle}
            aria-pressed={playback.playing}
            title="Play / pause (Space)"
          >
            <span className="replay-btn-icon" aria-hidden="true">{playback.playing ? '❚❚' : '▶'}</span>
            {playback.playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="replay-btn" onClick={() => playback.step(1)} title={`Next ${stepNoun.toLowerCase()} (→)`} disabled={playback.index >= total - 1}>
            {stepNoun}
            <span className="replay-btn-icon" aria-hidden="true">▶</span>
          </button>
          <button type="button" className="replay-btn" onClick={() => { playback.pause(); playback.nextGroup(); }} title={`Next ${groupNoun.toLowerCase()} (K)`}>
            {groupNoun}
            <span className="replay-btn-icon" aria-hidden="true">⏭</span>
          </button>
          <label className="replay-speed" title="Speed ([ and ])">
            <span className="visually-hidden">Speed</span>
            <select value={playback.speed} onChange={(event) => playback.setSpeed(Number(event.target.value) as StepSpeed)}>
              {STEP_SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="replay-counters" aria-live="off">
          <span>
            {stepNoun} {total ? playback.index + 1 : 0} / {total}
          </span>
          <span className="replay-shortcuts">Space play · ←/→ {stepNoun.toLowerCase()} · J/K {groupNoun.toLowerCase()} · [ ] speed</span>
        </div>
      </div>
    </div>
  );
}
