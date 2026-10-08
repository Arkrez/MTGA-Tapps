/**
 * Targeting arrows (pure): which arrows a board state shows, their colors and
 * curve geometry. The SVG overlay draws them; the arrow projector moves their
 * endpoints on rendered frames without React (scene/projection.ts).
 */
import type { Layout } from '../layout';
import { parseHex } from '../materials';
import { SLEEVE_COLORS } from '../prefs';
import type { SleeveColor } from '../prefs';
import type { BoardState } from '../reducer';
import { RAIL_WIDTH } from './cameraFit';

/** Where an arrow starts or ends. */
export type ArrowEnd =
  /** The stack item's card in the DOM stack preview. */
  | { kind: 'stack'; stackId: string }
  /** A card mesh (its animated pose). */
  | { kind: 'obj'; obj: string }
  /** A player: the middle of that seat's table edge. */
  | { kind: 'seat'; seat: number };

export type ArrowTone = 'target' | 'damage' | 'attack' | 'block';

export interface SceneArrow {
  id: string;
  from: ArrowEnd;
  to: ArrowEnd;
  /** Acting seat: picks the sleeve color. */
  seat: number;
  tone: ArrowTone;
}

/**
 * Arrows for one board state: every stack item to each of its targets
 * (bright, animated), the last non-combat damage from its source, and during
 * combat attackers toward the defending player and blockers toward the
 * attacker they block (dimmer). Only ends the scene can place are kept.
 */
export function sceneArrows(state: BoardState, layout: Layout): SceneArrow[] {
  const placed = new Set<string>();
  for (const card of layout.cards) if (card.row !== 'pile' && card.row !== 'stack') placed.add(card.obj);
  const arrows: SceneArrow[] = [];
  for (const item of state.stack) {
    item.targets.forEach((obj) => {
      // A counterspell's target is a spell on the stack: aim at its preview card.
      const spell = state.stack.find((other) => other !== item && other.kind === 'spell' && other.obj === obj);
      const to: ArrowEnd | null = spell ? { kind: 'stack', stackId: spell.stackId } : placed.has(obj) ? { kind: 'obj', obj } : null;
      if (!to) return;
      arrows.push({
        id: `target:${item.stackId}:${obj}`,
        from: { kind: 'stack', stackId: item.stackId },
        to,
        seat: item.controller,
        tone: 'target',
      });
    });
  }
  const last = state.lastEvent;
  if (last?.kind === 'damage' && !last.combat && last.source) {
    const source = state.objects.get(last.source);
    const onStack = state.stack.find((item) => item.obj === last.source);
    const from: ArrowEnd | null = placed.has(last.source)
      ? { kind: 'obj', obj: last.source }
      : onStack
        ? { kind: 'stack', stackId: onStack.stackId }
        : null;
    const to: ArrowEnd | null =
      last.target_obj && placed.has(last.target_obj)
        ? { kind: 'obj', obj: last.target_obj }
        : last.target_seat !== null && last.target_obj === null
          ? { kind: 'seat', seat: last.target_seat }
          : null;
    if (from && to) {
      arrows.push({
        id: `damage:${last.seq}`,
        from,
        to,
        seat: onStack?.controller ?? source?.controller ?? state.playerSeat,
        tone: 'damage',
      });
    }
  }
  if (state.attackers.size) {
    const blocked = new Set(state.blocks.values());
    const seats = Object.keys(state.seats).map(Number);
    for (const obj of state.attackers) {
      const attacker = state.objects.get(obj);
      if (!attacker || !placed.has(obj) || blocked.has(obj)) continue;
      const defender = seats.find((seat) => seat !== attacker.controller);
      if (defender === undefined) continue;
      arrows.push({
        id: `attack:${obj}`,
        from: { kind: 'obj', obj },
        to: { kind: 'seat', seat: defender },
        seat: attacker.controller,
        tone: 'attack',
      });
    }
    for (const [blocker, attacker] of state.blocks) {
      const object = state.objects.get(blocker);
      if (!object || !placed.has(blocker) || !placed.has(attacker)) continue;
      arrows.push({
        id: `block:${blocker}:${attacker}`,
        from: { kind: 'obj', obj: blocker },
        to: { kind: 'obj', obj: attacker },
        seat: object.controller,
        tone: 'block',
      });
    }
  }
  return arrows;
}

/** World point (table units) a player arrow aims at: the middle of that seat's rail. */
export function seatAnchor(
  layout: Pick<Layout, 'table'>,
  seat: number,
  playerSeat: number,
  out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): { x: number; y: number; z: number } {
  const y = layout.table.depth / 2 + RAIL_WIDTH / 2;
  out.x = 0;
  out.y = seat === playerSeat ? -y : y;
  out.z = 0.06;
  return out;
}

export interface NeonColors {
  /** Saturated halo color. */
  glow: string;
  /** Light core stroke. */
  core: string;
}

function hueOf([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function saturationOf([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
}

/**
 * Neon version of a sleeve's accent: same hue, pushed to a vivid halo and a
 * near-white core, so a navy sleeve glows blue and crimson glows red. Grey
 * sleeves (charcoal) stay neutral instead of picking up a random hue.
 */
export function neonColors(hex: string): NeonColors {
  const rgb = parseHex(hex);
  const hue = Math.round(hueOf(rgb));
  const grey = saturationOf(rgb) < 0.12;
  const sat = grey ? 0 : 92;
  return {
    glow: `hsl(${hue} ${sat}% 58%)`,
    core: `hsl(${hue} ${grey ? 0 : 100}% 86%)`,
  };
}

export function sleeveNeon(sleeve: SleeveColor): NeonColors {
  return neonColors(SLEEVE_COLORS[sleeve].accent);
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Control point of the quadratic curve from (sx, sy) to (tx, ty): the
 * midpoint pushed sideways by `bend` × the chord length, always toward the
 * top of the screen (or to the left for a vertical chord, away from the stack
 * preview on the right edge) so arrows arc over the board instead of cutting
 * straight across it.
 */
export function arrowControlPoint(sx: number, sy: number, tx: number, ty: number, bend: number, out: Point): Point {
  const dx = tx - sx;
  const dy = ty - sy;
  const length = Math.hypot(dx, dy);
  let nx = length ? dy / length : 0;
  let ny = length ? -dx / length : -1;
  if (ny > 0 || (ny === 0 && nx > 0)) {
    nx = -nx;
    ny = -ny;
  }
  out.x = (sx + tx) / 2 + nx * bend * length;
  out.y = (sy + ty) / 2 + ny * bend * length;
  return out;
}

/** Bend for a chord: gentle on long arrows, a little rounder on short ones. */
export function arrowBend(length: number): number {
  return length < 120 ? 0.32 : length > 600 ? 0.16 : 0.32 - ((length - 120) / 480) * 0.16;
}

export interface ArrowShape {
  /** SVG path data of the curve (ends at the arrowhead's base). */
  d: string;
  /** SVG polygon points of the arrowhead. */
  head: string;
}

const control: Point = { x: 0, y: 0 };

/**
 * Curve and arrowhead between two screen points (integers in CSS pixels).
 * The head points along the curve's tangent at the target; the curve stops
 * at the head's base so the stroke never pokes through the tip.
 */
export function arrowShape(sx: number, sy: number, tx: number, ty: number, headLength = 16): ArrowShape {
  const length = Math.hypot(tx - sx, ty - sy);
  arrowControlPoint(sx, sy, tx, ty, arrowBend(length), control);
  let ux = tx - control.x;
  let uy = ty - control.y;
  const tangent = Math.hypot(ux, uy) || 1;
  ux /= tangent;
  uy /= tangent;
  const head = Math.min(headLength, length * 0.4);
  const bx = tx - ux * head;
  const by = ty - uy * head;
  const half = head * 0.55;
  const r = (v: number) => Math.round(v * 10) / 10;
  return {
    d: `M${r(sx)} ${r(sy)} Q${r(control.x)} ${r(control.y)} ${r(bx)} ${r(by)}`,
    head: `${r(tx)},${r(ty)} ${r(bx - uy * half)},${r(by + ux * half)} ${r(bx + uy * half)},${r(by - ux * half)}`,
  };
}
