import { describe, expect, it } from 'vitest';
import { makeSampleStream } from './fixtures/sampleStream';
import { fractionOfIndex, indexAtFraction, initialSeq, scrubSegments, visibleTurnLabels } from './scrub';

describe('scrub bar geometry', () => {
  const stream = makeSampleStream();

  it('covers the bar with a pre-game segment and one segment per turn', () => {
    const segments = scrubSegments(stream);
    expect(segments[0]).toMatchObject({ turn: null, start: 0 });
    expect(segments.slice(1).map((s) => s.turn)).toEqual(stream.turns.map((t) => t.turn));
    for (let i = 1; i < segments.length; i += 1) expect(segments[i].start).toBeCloseTo(segments[i - 1].end);
    expect(segments[segments.length - 1].end).toBe(1);
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

  it('opens a deep link at ?at=, else the first event of ?row=, else the start', () => {
    const tagged = {
      ...stream,
      events: stream.events.map((event, i) => ({ ...event, row_id: i >= 4 ? 100 + Math.floor(i / 2) : null })),
    };
    const first = tagged.events.find((event) => event.row_id === 103)!;
    expect(first.seq).toBe(tagged.events[6].seq);
    expect(initialSeq(tagged, null, 103)).toBe(first.seq);
    expect(initialSeq(tagged, 2, 103)).toBe(2);
    expect(initialSeq(tagged, null, 999)).toBeNull();
    expect(initialSeq(tagged, null, null)).toBeNull();
  });
});
