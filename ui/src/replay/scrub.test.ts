import { describe, expect, it } from 'vitest';
import { makeSampleStream } from './fixtures/sampleStream';
import { fractionOfIndex, indexAtFraction, initialSeq, openingEndIndex, openingEndSeq, scrubSegments, visibleTurnLabels } from './scrub';

describe('scrub bar geometry', () => {
  const stream = makeSampleStream();

  it('covers the bar from turn 1 with one segment per turn; the opening deal is not on it', () => {
    const segments = scrubSegments(stream);
    expect(segments[0]).toMatchObject({ turn: stream.turns[0].turn, start: 0 });
    expect(segments.map((s) => s.turn)).toEqual(stream.turns.map((t) => t.turn));
    for (let i = 1; i < segments.length; i += 1) expect(segments[i].start).toBeCloseTo(segments[i - 1].end);
    expect(segments[segments.length - 1].end).toBe(1);
    // Turn 1's share is its own events over the navigable range, not the pre-game ones.
    const first = openingEndIndex(stream.events);
    const second = stream.events.findIndex((e) => e.kind === 'turn' && e.seq === stream.turns[1].first_seq);
    expect(segments[0].end).toBeCloseTo((second - first) / (stream.events.length - first));
    // No turn headers at all: one pre-game segment spanning the bar.
    const noTurns = { ...stream, turns: [], events: stream.events.filter((e) => e.kind !== 'turn') };
    expect(scrubSegments(noTurns)).toMatchObject([{ turn: null, start: 0, end: 1 }]);
  });

  it('converts between bar position and event index', () => {
    expect(fractionOfIndex(0, 10)).toBe(0);
    expect(fractionOfIndex(9, 10)).toBe(1);
    expect(indexAtFraction(0.5, 11)).toBe(5);
    expect(indexAtFraction(-1, 11)).toBe(0);
    expect(indexAtFraction(2, 11)).toBe(10);
  });

  it('drops turn labels that would overlap', () => {
    const segments = scrubSegments(stream);
    expect(visibleTurnLabels(segments, 2000).size).toBe(stream.turns.length);
    expect(visibleTurnLabels(segments, 40).size).toBeLessThan(stream.turns.length);
  });

  it('opens a deep link at ?at=, else the first event of ?row=, else turn 1 with the hands dealt', () => {
    const tagged = {
      ...stream,
      events: stream.events.map((event, i) => ({ ...event, row_id: i >= 4 ? 100 + Math.floor(i / 2) : null })),
    };
    const first = tagged.events.find((event) => event.row_id === 103)!;
    expect(first.seq).toBe(tagged.events[6].seq);
    expect(initialSeq(tagged, null, 103)).toBe(first.seq);
    expect(initialSeq(tagged, 2, 103)).toBe(2);
    // Unknown row or no link: turn 1, with the opening hands dealt.
    const start = openingEndSeq(tagged);
    expect(start).toBe(tagged.events[openingEndIndex(tagged.events)].seq);
    expect(tagged.events[openingEndIndex(tagged.events)].kind).toBe('turn');
    expect(openingEndIndex(tagged.events)).toBeGreaterThan(0);
    expect(initialSeq(tagged, null, 999)).toBe(start);
    expect(initialSeq(tagged, null, null)).toBe(start);
    // A stream with no turn header starts at its first event.
    const noTurns = { ...tagged, events: tagged.events.filter((e) => e.kind !== 'turn') };
    expect(openingEndIndex(noTurns.events)).toBe(0);
    expect(openingEndSeq({ ...tagged, events: [] })).toBeNull();
  });
});
