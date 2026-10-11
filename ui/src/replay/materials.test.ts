import { afterEach, describe, expect, it, vi } from 'vitest';
import { card } from './fixtures/streamBuilder';
import {
  FACE_HEIGHT,
  FACE_WIDTH,
  FELT_SIZE,
  SLEEVE_HEIGHT,
  SLEEVE_WIDTH,
  createFeltCanvas,
  createSleeveCanvas,
  createTokenFaceCanvas,
  parseHex,
  shade,
} from './materials';

/** Minimal stand-in for a 2D context: every method is a no-op that records its name. */
function fakeContext(calls: string[]): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: number[]) => {
        calls.push(prop);
        if (prop === 'createImageData') {
          return { data: new Uint8ClampedArray(args[0] * args[1] * 4), width: args[0], height: args[1] };
        }
        if (prop === 'measureText') return { width: 100 };
        if (prop.startsWith('create')) return gradient;
        return undefined;
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

const token = card('Saproling', 'Creature', { power: '1', toughness: '1', is_token: true, color_identity: 'G' });

afterEach(() => vi.restoreAllMocks());

describe('replay materials', () => {
  it('returns blank canvases of the right size when 2D is unavailable', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const felt = createFeltCanvas('#1f6b4a');
    const sleeve = createSleeveCanvas('#1b2a4e');
    const face = createTokenFaceCanvas(token);
    expect([felt.width, felt.height]).toEqual([FELT_SIZE, FELT_SIZE]);
    expect([sleeve.width, sleeve.height]).toEqual([SLEEVE_WIDTH, SLEEVE_HEIGHT]);
    expect([face.width, face.height]).toEqual([FACE_WIDTH, FACE_HEIGHT]);
  });

  it('draws with a 2D context without throwing', () => {
    const calls: string[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (() => fakeContext(calls)) as unknown as HTMLCanvasElement['getContext'],
    );
    expect(() => createFeltCanvas('#9a7444')).not.toThrow();
    expect(calls).toContain('putImageData');
    expect(() => createSleeveCanvas('#7a1424', '#b0324a')).not.toThrow();
    expect(() => createTokenFaceCanvas(token)).not.toThrow();
    expect(() => createTokenFaceCanvas(card('Treasure', 'Artifact'))).not.toThrow();
    expect(calls).toContain('fillText');
  });

  it('parses and shades hex colors', () => {
    expect(parseHex('#1f6b4a')).toEqual([31, 107, 74]);
    expect(parseHex('nope')).toEqual([128, 128, 128]);
    expect(shade('#000000', 1)).toBe('rgb(255, 255, 255)');
    expect(shade('#ffffff', -0.5)).toBe('rgb(128, 128, 128)');
  });
});
