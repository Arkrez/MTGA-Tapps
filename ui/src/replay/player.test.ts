import { describe, expect, it } from 'vitest';
import { makeSampleStream } from './fixtures/sampleStream';
import { StreamBuilder, card } from './fixtures/streamBuilder';
import { PlaybackClock, holdMs } from './player';
import type { PlaybackSnapshot } from './player';
import { buildTimeline } from './reducer';

class FakeTime {
  now = 0;
  timers: Array<{ at: number; cb: () => void; id: number }> = [];
  private nextId = 0;

  schedule = (cb: () => void, ms: number) => {
    const id = this.nextId++;
    this.timers.push({ at: this.now + ms, cb, id });
    return () => {
      this.timers = this.timers.filter((t) => t.id !== id);
    };
  };

  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const due = this.timers[0];
      if (!due || due.at > end) break;
      this.timers.shift();
      this.now = due.at;
      due.cb();
    }
    this.now = end;
  }
}

/**
 * Events at t = 0, 1, 11, 11.5 seconds (gaps 1 s, 10 s, 0.5 s), two turns.
 * Turn 1's header comes first so the whole fixture is navigable (playback
 * starts at the first turn header).
 */
function smallTimeline() {
  const b = new StreamBuilder();
  b.turnStart(1, 1);
  b.events[0].t = 0;
  b.add('game_start', { seats_hand_sizes: { 1: 0, 2: 0 }, library_sizes: { 1: 1, 2: 1 } }, { dt: 0 });
  b.events[1].t = 1;
  b.add('note', {}, { text: 'a' });
  b.events[2].t = 11;
  b.turnStart(2, 2);
  b.events[3].t = 11.5;
  return buildTimeline(b.build({ a: card('A', 'Land') }, { playerSeat: 1 }));
}

function setup(opts: { speed?: 1 | 2 | 4 | 8 | 0.5; pacing?: 'paced' | 'realtime' } = {}) {
  const time = new FakeTime();
  const timeline = smallTimeline();
  const clock = new PlaybackClock(timeline, { now: () => time.now, schedule: time.schedule, ...opts });
  const seen: PlaybackSnapshot[] = [];
  clock.subscribe((s) => seen.push(s));
  return { time, clock, seen, timeline };
}

describe('holdMs', () => {
  it('clamps paced holds to 600..2500 ms and scales by speed', () => {
    expect(holdMs(0, 'paced', 1)).toBe(600);
    expect(holdMs(4, 'paced', 1)).toBe(1000);
    expect(holdMs(60, 'paced', 1)).toBe(2500);
    expect(holdMs(4, 'paced', 2)).toBe(500);
    expect(holdMs(0, 'paced', 0.5)).toBe(1200);
  });

  it('uses the real gap in real-time mode', () => {
    expect(holdMs(3, 'realtime', 1)).toBe(3000);
    expect(holdMs(3, 'realtime', 4)).toBe(750);
    expect(holdMs(-1, 'realtime', 1)).toBe(0);
  });
});

describe('PlaybackClock', () => {
  it('advances on paced holds and stops at the end', () => {
    const { time, clock, seen } = setup();
    expect(clock.seq).toBe(0);
    clock.play();
    expect(seen.at(-1)).toMatchObject({ playing: true, seq: 0 });
    time.advance(599);
    expect(clock.seq).toBe(0);
    time.advance(1);
    expect(clock.seq).toBe(1);
    time.advance(2500); // gap 10 s -> capped at 2.5 s
    expect(clock.seq).toBe(2);
    time.advance(600); // gap 0.5 s -> 600 ms floor
    expect(clock.seq).toBe(3);
    expect(clock.snapshot).toMatchObject({ playing: false, atEnd: true, turn: 2 });
    expect(time.timers).toHaveLength(0);
  });

  it('emits exactly one notification per tick', () => {
    const { time, clock, seen } = setup();
    clock.play();
    const before = seen.length;
    time.advance(600);
    expect(seen.length).toBe(before + 1);
    expect(seen.at(-1)?.seq).toBe(1);
  });

  it('follows real gaps divided by speed in real-time mode', () => {
    const { time, clock } = setup({ pacing: 'realtime', speed: 2 });
    clock.play();
    time.advance(500);
    expect(clock.seq).toBe(1);
    time.advance(4999);
    expect(clock.seq).toBe(1);
    time.advance(1);
    expect(clock.seq).toBe(2);
  });

  it('compensates for late timers', () => {
    const { time, clock } = setup({ pacing: 'realtime' });
    clock.play();
    time.now += 300; // the browser was busy; the timer fires 300 ms late
    time.advance(1000);
    expect(clock.seq).toBe(1);
    const next = time.timers[0];
    expect(next.at - time.now).toBe(10000 - 300);
  });

  it('never schedules while paused and cancels on dispose', () => {
    const { time, clock } = setup();
    clock.play();
    clock.pause();
    expect(time.timers).toHaveLength(0);
    clock.seek(2);
    clock.setSpeed(4);
    expect(time.timers).toHaveLength(0);
    clock.play();
    expect(time.timers).toHaveLength(1);
    clock.dispose();
    expect(time.timers).toHaveLength(0);
    clock.play();
    expect(time.timers).toHaveLength(0);
  });

  it('reschedules when the speed changes mid-hold', () => {
    const { time, clock } = setup();
    clock.play();
    clock.setSpeed(2);
    expect(time.timers).toHaveLength(1);
    time.advance(300);
    expect(clock.seq).toBe(1);
  });

  it('steps one event at a time and pauses', () => {
    const { clock } = setup();
    clock.play();
    clock.step(1);
    expect(clock.snapshot).toMatchObject({ seq: 1, playing: false });
    clock.step(-1);
    clock.step(-1);
    expect(clock.seq).toBe(0);
  });

  it('restarts from the first turn header when played at the end', () => {
    const { time, clock } = setup();
    clock.seek(99);
    expect(clock.seq).toBe(3);
    clock.play();
    const start = clock.startSeq;
    expect(clock.snapshot).toMatchObject({ seq: start, playing: true });
    time.advance(3000);
    expect(clock.seq).toBeGreaterThan(start);
    // A real stream restarts at turn 1, after the opening deal.
    const stream = makeSampleStream();
    const full = new PlaybackClock(buildTimeline(stream), { schedule: () => () => undefined, now: () => 0 });
    const firstTurn = stream.events.find((e) => e.kind === 'turn')!;
    expect(full.startSeq).toBe(firstTurn.seq);
    expect(full.firstSeq).toBe(full.startSeq);
    full.seek(full.lastSeq);
    full.play();
    expect(full.seq).toBe(firstTurn.seq);
    full.dispose();
  });

  it('jumps between turns', () => {
    const timeline = buildTimeline(makeSampleStream());
    const clock = new PlaybackClock(timeline, { schedule: () => () => undefined, now: () => 0 });
    const turns = timeline.stream.turns;
    clock.seekTurn(3);
    expect(clock.seq).toBe(turns[2].first_seq);
    clock.nextTurn();
    expect(clock.seq).toBe(turns[3].first_seq);
    clock.step(1);
    clock.prevTurn();
    expect(clock.seq).toBe(turns[3].first_seq);
    clock.prevTurn();
    expect(clock.seq).toBe(turns[2].first_seq);
    clock.seekTurn(1);
    clock.prevTurn();
    // Nothing before turn 1 is navigable.
    expect(clock.seq).toBe(clock.firstSeq);
    expect(clock.firstSeq).toBe(turns[0].first_seq);
    clock.seekTurn(5);
    clock.nextTurn();
    expect(clock.seq).toBe(clock.lastSeq);
  });
});
