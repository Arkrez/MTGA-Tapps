import { describe, expect, it } from 'vitest';
import { Group } from 'three';
import { OPPONENT, PLAYER, makeSampleStream } from '../fixtures/sampleStream';
import { layoutBoard } from '../layout';
import { buildTimeline, stateAt } from '../reducer';
import { MAX_STRETCH, dampFactor, depthStretch, spawnPose, stepPose, stretchedScale } from './motion';
import type { Pose } from './motion';
import { MotionRegistry } from './motionRegistry';

const pose = (x: number, y = 0): Pose => ({ x, y, z: 0, rotZ: 0, rotY: 0, scale: 1 });

describe('card motion', () => {
  it('damps frame-rate independently and clamps long gaps', () => {
    const twoSmall = 1 - (1 - dampFactor(1 / 120)) ** 2;
    expect(twoSmall).toBeCloseTo(dampFactor(1 / 60), 6);
    expect(dampFactor(5)).toBe(dampFactor(0.1));
    expect(dampFactor(0)).toBe(0);
  });

  it('converges and snaps exactly onto the target', () => {
    const current = pose(0);
    const target = { ...pose(4, -2), rotZ: Math.PI / 2, rotY: Math.PI, scale: 0.85 };
    let frames = 0;
    while (!stepPose(current, target, dampFactor(1 / 60))) frames += 1;
    expect(current).toEqual(target);
    expect(frames).toBeGreaterThan(10);
    expect(frames).toBeLessThan(90);
  });

  it('spawns a drawn card at its library pile and a cast spell from hand', () => {
    const stream = makeSampleStream();
    const timeline = buildTimeline(stream);
    const draw = stream.events.find((e) => e.kind === 'move' && e.obj === '217')!;
    const state = stateAt(timeline, draw.seq);
    const layout = layoutBoard(state, { mirrorOpponent: false, hindsight: true, playerSeat: PLAYER });
    const placement = layout.cards.find((c) => c.obj === '217')!;
    const library = layout.piles.find((p) => p.seat === PLAYER && p.zone === 'library')!;
    const start = spawnPose(placement, state, layout, () => null);
    expect([start.x, start.y]).toEqual([library.x, library.y]);

    const cast = stream.events.find((e) => e.kind === 'move' && e.obj === '104' && e.to === 'stack')!;
    const castState = stateAt(timeline, cast.seq);
    const castLayout = layoutBoard(castState, { mirrorOpponent: false, hindsight: true, playerSeat: PLAYER });
    const spell = castLayout.cards.find((c) => c.obj === '104')!;
    const from = spawnPose(spell, castState, castLayout, () => null);
    expect(from.y).toBeGreaterThan(3); // the opponent's hand is on the far side
    expect(castState.seats[OPPONENT]).toBeDefined();
  });
});

describe('depth stretch', () => {
  it('is 1 straight down or without a viewer, grows with the view angle, and is capped', () => {
    expect(depthStretch(null, 0, 3, 0)).toBe(1);
    const cam = { x: 0, y: -10, z: 10 };
    expect(depthStretch(cam, 0, -10, 0)).toBeCloseTo(1, 9);
    // 45° view ray: sqrt(2).
    expect(depthStretch(cam, 0, 0, 0)).toBeCloseTo(Math.SQRT2, 9);
    const far = depthStretch(cam, 0, 4, 0);
    expect(far).toBeGreaterThan(Math.SQRT2);
    expect(depthStretch(cam, 0, 100, 0)).toBe(MAX_STRETCH);
    // A lifted card sees a slightly shallower ray.
    expect(depthStretch(cam, 0, 0, 1)).toBeGreaterThan(Math.SQRT2);
    expect(depthStretch(cam, 0, 0, 20)).toBe(1);
  });

  it('stretches an untapped card along its height and a tapped one along its width', () => {
    const out = { x: 0, y: 0 };
    expect(stretchedScale(0.8, 1.5, 0, out)).toEqual({ x: 0.8, y: 0.8 * 1.5 });
    stretchedScale(0.8, 1.5, Math.PI / 2, out);
    expect(out.x).toBeCloseTo(1.2, 9);
    expect(out.y).toBeCloseTo(0.8, 9);
    stretchedScale(1, 1, 0.7, out);
    expect(out).toEqual({ x: 1, y: 1 });
  });
});

describe('MotionRegistry', () => {
  it('animates from the spawn pose, reports busy until settled, and snaps on seeks', () => {
    const registry = new MotionRegistry();
    const group = new Group();
    registry.set('a', group, null, pose(2), pose(0));
    expect(registry.busy).toBe(true);
    expect(group.position.x).toBe(0);
    let frames = 0;
    while (registry.step(1 / 60)) frames += 1;
    expect(frames).toBeGreaterThan(5);
    expect(group.position.x).toBe(2);
    expect(registry.busy).toBe(false);

    registry.setSnap(true);
    registry.set('a', group, null, pose(-3), null);
    expect(group.position.x).toBe(-3);
    expect(registry.busy).toBe(false);
    expect(registry.step(1 / 60)).toBe(false);

    registry.remove('a', group);
    expect(registry.size).toBe(0);
    expect(registry.pose('a')).toBeNull();
  });

  it('lifts a travelling card in an arc and lands it flat', () => {
    const registry = new MotionRegistry();
    const group = new Group();
    registry.set('a', group, null, pose(6), pose(0));
    let peak = 0;
    while (registry.step(1 / 60)) peak = Math.max(peak, group.position.z);
    expect(peak).toBeGreaterThan(0.2);
    expect(group.position.z).toBe(0);
    expect(registry.pose('a')?.x).toBe(6);
  });
});
