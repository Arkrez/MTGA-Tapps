/**
 * Turn-segmented scrub bar colored by the active seat, with turn ticks and a
 * draggable playhead. Dragging pauses playback and resumes it on release if
 * it was playing.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { PlaybackClock, PlaybackSnapshot } from '../player';
import { fractionOfIndex, indexAtFraction, scrubSegments, visibleTurnLabels } from '../scrub';
import type { ReplayStream } from '../types';

interface ScrubBarProps {
  stream: ReplayStream;
  clock: PlaybackClock;
  snapshot: PlaybackSnapshot;
}

export function ScrubBar({ stream, clock, snapshot }: ScrubBarProps) {
  const segments = useMemo(() => scrubSegments(stream), [stream]);
  const total = stream.events.length;
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ resume: boolean; frame: number; fraction: number } | null>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const node = track.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width || 800));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Leaving the page mid-drag must not run a queued seek against a disposed clock.
  useEffect(() => {
    const dragRef = drag;
    return () => {
      if (dragRef.current?.frame) cancelAnimationFrame(dragRef.current.frame);
      dragRef.current = null;
    };
  }, []);

  const seekFraction = (fraction: number) => {
    const event = stream.events[indexAtFraction(fraction, total)];
    if (event) clock.seek(event.seq);
  };
  const fractionAt = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = { resume: snapshot.playing, frame: 0, fraction: fractionAt(event.clientX) };
    clock.pause();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    seekFraction(drag.current.fraction);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    state.fraction = fractionAt(event.clientX);
    if (state.frame) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      seekFraction(state.fraction);
    });
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    if (state.frame) cancelAnimationFrame(state.frame);
    drag.current = null;
    seekFraction(fractionAt(event.clientX));
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (state.resume && !clock.snapshot.atEnd) clock.play();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Arrow keys are handled by the page-wide shortcuts; Page keys jump turns here.
    if (event.key === 'PageUp') {
      event.preventDefault();
      clock.nextTurn();
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      clock.prevTurn();
    }
  };

  const turnSegments = segments.filter((segment) => segment.turn !== null);
  const labelled = useMemo(() => visibleTurnLabels(segments, width), [segments, width]);
  const position = fractionOfIndex(snapshot.index, total) * 100;
  const current = stream.events[snapshot.index];
  return (
    <div className="replay-scrub">
      <div className="replay-scrub-labels" aria-hidden="true">
        {turnSegments.map((segment) =>
          labelled.has(segment.key) ? (
            <span key={segment.key} style={{ left: `${segment.start * 100}%` }}>
              T{segment.turn}
            </span>
          ) : null,
        )}
      </div>
      <div
        ref={track}
        className="replay-scrub-track"
        role="slider"
        tabIndex={0}
        aria-label="Replay position"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, total - 1)}
        aria-valuenow={snapshot.index}
        aria-valuetext={`Event ${snapshot.index + 1} of ${total}${snapshot.turn ? `, turn ${snapshot.turn}` : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={`replay-scrub-segment ${
              segment.seat === null ? 'replay-seg-pre' : segment.seat === stream.player_seat ? 'replay-seg-you' : 'replay-seg-opp'
            }${current && segment.turn !== null && segment.turn === snapshot.turn ? ' replay-seg-current' : ''}`}
            style={{ left: `${segment.start * 100}%`, width: `${(segment.end - segment.start) * 100}%` }}
            title={segment.turn === null ? 'Pre-game' : `Turn ${segment.turn}`}
          />
        ))}
        <span className="replay-scrub-head" style={{ left: `${position}%` }} />
      </div>
    </div>
  );
}
