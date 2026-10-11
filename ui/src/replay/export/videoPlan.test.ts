import { describe, expect, it } from 'vitest';
import { makeSampleStream } from '../fixtures/sampleStream';
import { holdMs } from '../player';
import { EXPORT_FPS, EXPORT_TAIL_SECONDS, MAX_EXPORT_FRAMES, buildVideoPlan, exportFileName } from './videoPlan';

describe('video plan', () => {
  const stream = makeSampleStream();
  const events = stream.events;

  it('gives every event the player’s own hold at the chosen speed, then holds the last frame', () => {
    const plan = buildVideoPlan(events, { speed: 1, pacing: 'paced' });
    expect(plan.fps).toBe(EXPORT_FPS);
    expect(plan.fromIndex).toBe(0);
    expect(plan.toIndex).toBe(events.length - 1);
    // Frames are non-decreasing event indices covering the whole range.
    for (let i = 1; i < plan.frames.length; i += 1) expect(plan.frames[i]).toBeGreaterThanOrEqual(plan.frames[i - 1]);
    expect(plan.frames[0]).toBe(0);
    expect(plan.frames[plan.frames.length - 1]).toBe(events.length - 1);
    // The final event holds for the tail.
    const tailFrames = plan.frames.filter((i) => i === events.length - 1).length;
    expect(tailFrames).toBe(EXPORT_TAIL_SECONDS * EXPORT_FPS);
    // Total length matches the summed holds (within one frame per event of rounding).
    let expected = EXPORT_TAIL_SECONDS;
    for (let i = 0; i < events.length - 1; i += 1) expected += holdMs(events[i + 1].t - events[i].t, 'paced', 1) / 1000;
    expect(Math.abs(plan.seconds - expected)).toBeLessThan(events.length / EXPORT_FPS);
    expect(plan.truncated).toBe(false);
  });

  it('is shorter at a faster speed and honors a sub-range', () => {
    const slow = buildVideoPlan(events, { speed: 1, pacing: 'paced' });
    const fast = buildVideoPlan(events, { speed: 4, pacing: 'paced' });
    expect(fast.seconds).toBeLessThan(slow.seconds);
    const part = buildVideoPlan(events, { speed: 1, pacing: 'paced', fromIndex: 5, toIndex: 9, tailSeconds: 1 });
    expect(part.frames[0]).toBe(5);
    expect(part.frames[part.frames.length - 1]).toBe(9);
    expect(new Set(part.frames).size).toBe(5);
    // Out-of-range indices clamp; an inverted range collapses to one event.
    const clamped = buildVideoPlan(events, { speed: 1, pacing: 'paced', fromIndex: -3, toIndex: 10_000 });
    expect(clamped.fromIndex).toBe(0);
    expect(clamped.toIndex).toBe(events.length - 1);
    const inverted = buildVideoPlan(events, { speed: 1, pacing: 'paced', fromIndex: 8, toIndex: 2, tailSeconds: 1 });
    expect(inverted.fromIndex).toBe(8);
    expect(inverted.toIndex).toBe(8);
    expect(inverted.frames.length).toBe(EXPORT_FPS);
  });

  it('caps the frame count and reports truncation; an empty stream gives an empty plan', () => {
    const long = Array.from({ length: 3000 }, (_, i) => ({ ...events[0], seq: i + 1, t: i * 60 }));
    const plan = buildVideoPlan(long, { speed: 0.5, pacing: 'realtime' });
    expect(plan.frames.length).toBe(MAX_EXPORT_FRAMES);
    expect(plan.truncated).toBe(true);
    expect(buildVideoPlan([], { speed: 1, pacing: 'paced' }).frames.length).toBe(0);
  });

  it('names the file after the opponent and the date', () => {
    expect(exportFileName(stream)).toMatch(/^replay-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.mp4$/);
    const nameless = { ...stream, seats: { ...stream.seats }, game: { ...stream.game, started_at: '' } };
    for (const seat of Object.values(nameless.seats)) seat.name = '';
    expect(exportFileName(nameless)).toMatch(/^replay-[a-z0-9-]+-replay\.mp4$/);
  });
});
