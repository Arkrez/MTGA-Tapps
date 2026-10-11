import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReplayUnavailableError, fetchReplay } from '../api';
import { makeLongStream } from './fixtures/longStream';
import { sampleStream } from './fixtures/sampleStream';
import { EVENT_KINDS, ZONES, isZone, stackKindOf } from './types';
import type { StackPushEvent } from './types';

afterEach(() => vi.restoreAllMocks());

describe('replay stream fixtures', () => {
  it('exercise every event kind and follow the producer rules', () => {
    const kinds = new Set(sampleStream.events.map((e) => e.kind));
    expect([...EVENT_KINDS].filter((k) => !kinds.has(k))).toEqual([]);
    expect(sampleStream.events[0].kind).toBe('game_start');
    sampleStream.events.forEach((event, i) => {
      expect(event.seq).toBe(i);
      if (i) expect(event.t).toBeGreaterThanOrEqual(sampleStream.events[i - 1].t);
    });
    const turnEvents = sampleStream.events.filter((e) => e.kind === 'turn');
    expect(sampleStream.turns.map((t) => t.first_seq)).toEqual(turnEvents.map((e) => e.seq));
    expect(sampleStream.turns.at(-1)?.last_seq).toBe(sampleStream.events.length - 1);
  });

  it('generates long streams of the requested size', () => {
    const stream = makeLongStream(10, 30);
    expect(stream.turns).toHaveLength(10);
    expect(stream.events.length).toBeGreaterThanOrEqual(300);
  });
});

describe('type helpers', () => {
  it('recognizes zones', () => {
    expect(ZONES).toContain('limbo');
    expect(isZone('battlefield')).toBe(true);
    expect(isZone('unknown')).toBe(false);
  });

  it('reads the stack item kind from stack_kind or item_kind', () => {
    const push = sampleStream.events.find((e): e is StackPushEvent => e.kind === 'stack_push')!;
    expect(stackKindOf(push)).toBe('spell');
    expect(stackKindOf({ ...push, stack_kind: undefined, item_kind: 'activated' })).toBe('activated');
    expect(stackKindOf({ ...push, stack_kind: undefined, text: 'Draw a card' })).toBe('trigger');
  });
});

describe('fetchReplay', () => {
  it('requests the stream by query id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(sampleStream)));
    const stream = await fetchReplay('game:1');
    expect(fetchMock).toHaveBeenCalledWith('/api/replay?id=game%3A1', { signal: undefined });
    expect(stream.events).toHaveLength(sampleStream.events.length);
  });

  it('distinguishes an unavailable replay from an unknown game', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'replay_unavailable', reason: 'no events' }), { status: 404 }),
    );
    const error = await fetchReplay('g').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReplayUnavailableError);
    expect((error as ReplayUnavailableError).reason).toBe('no events');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 404 }));
    await expect(fetchReplay('missing')).rejects.toThrow('No recorded game');
  });
});
