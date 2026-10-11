import { describe, expect, it } from 'vitest';
import { CanvasTexture, SRGBColorSpace, Vector3 } from 'three';

// Smoke test: three.js loads under vitest/jsdom so scene code can be unit-tested.
describe('three.js under vitest', () => {
  it('imports and does vector math', () => {
    const v = new Vector3(1, 2, 2);
    expect(v.length()).toBe(3);
    const texture = new CanvasTexture(document.createElement('canvas'));
    texture.colorSpace = SRGBColorSpace;
    expect(texture.colorSpace).toBe(SRGBColorSpace);
    texture.dispose();
  });
});
