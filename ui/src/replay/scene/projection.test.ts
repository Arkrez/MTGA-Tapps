import { describe, expect, it } from 'vitest';
import { OrthographicCamera } from 'three';
import { positionLabels, projectToScreen } from './projection';
import type { SceneLabel } from './labels';

function camera() {
  const c = new OrthographicCamera(-8, 8, 5, -5, 1, 100);
  c.position.set(0, 0, 40);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  c.updateProjectionMatrix();
  return c;
}

describe('label projection', () => {
  it('maps world points to canvas pixels', () => {
    const out = { x: 0, y: 0, visible: false };
    projectToScreen(camera(), 0, 0, 0, 800, 500, out);
    expect(out).toEqual({ x: 400, y: 250, visible: true });
    projectToScreen(camera(), 8, 5, 0, 800, 500, out);
    expect(out.x).toBeCloseTo(800);
    expect(out.y).toBeCloseTo(0);
  });

  it('positions label elements and follows animated meshes', () => {
    const root = document.createElement('div');
    root.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
    const labels: SceneLabel[] = [
      { id: 'a', text: 'Library 3', tone: 'pile', obj: null, x: -8, y: 0, z: 0, align: 'center' },
      { id: 'b', text: '3/3', tone: 'stat', obj: 'card', x: 0, y: -1, z: 0, align: 'start' },
      { id: 'c', text: 'gone', tone: 'stat', obj: 'missing', x: 0, y: 0, z: 0, align: 'center' },
    ];
    const poses = (obj: string) => (obj === 'card' ? { x: 4, y: 1, z: 0 } : null);
    positionLabels(root, labels, camera(), { width: 800, height: 500 }, poses, { x: 0, y: 0, visible: false });
    const [a, b, c] = Array.from(root.children) as HTMLElement[];
    expect(a.style.transform).toBe('translate(0px, 250px) translateX(-50%)');
    expect(a.style.opacity).toBe('1');
    expect(b.style.transform).toBe('translate(600px, 250px) translateY(-50%)');
    expect(c.style.opacity).toBe('0');
  });

  it('skips DOM writes for labels whose rounded position did not change', () => {
    const root = document.createElement('div');
    root.append(document.createElement('span'));
    const labels: SceneLabel[] = [{ id: 'a', text: 'Library 3', tone: 'pile', obj: null, x: 0, y: 0, z: 0, align: 'center' }];
    const point = { x: 0, y: 0, visible: false };
    positionLabels(root, labels, camera(), { width: 800, height: 500 }, () => null, point);
    const node = root.children[0] as HTMLElement;
    expect(node.style.transform).toBe('translate(400px, 250px) translateX(-50%)');
    // Same frame again: nothing is rebuilt or rewritten (a marker survives).
    node.style.transform = 'translate(1px, 1px)';
    positionLabels(root, labels, camera(), { width: 800, height: 500 }, () => null, point);
    expect(node.style.transform).toBe('translate(1px, 1px)');
    // A real move rewrites it.
    positionLabels(root, labels, camera(), { width: 1000, height: 500 }, () => null, point);
    expect(node.style.transform).toBe('translate(500px, 250px) translateX(-50%)');
  });
});
