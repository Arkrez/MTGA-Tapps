/**
 * Procedural canvases for the replay table: felt cloth, card sleeves and a
 * generic face for cards without an image. No bundled images and no Wizards
 * of the Coast art or trade dress. When a 2D context is unavailable (jsdom),
 * each function returns the blank canvas instead of throwing.
 */
import type { ReplayCard } from './types';

export const FELT_SIZE = 512;
export const SLEEVE_WIDTH = 256;
export const SLEEVE_HEIGHT = 358;
export const FACE_WIDTH = 488;
export const FACE_HEIGHT = 680;

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const value = match ? parseInt(match[1], 16) : 0x808080;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** amount > 0 lightens toward white, < 0 darkens toward black. */
export function shade(hex: string, amount: number): string {
  const target = amount >= 0 ? 255 : 0;
  const t = Math.min(1, Math.abs(amount));
  const [r, g, b] = parseHex(hex).map((c) => Math.round(c + (target - c) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

function makeCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  return { canvas, ctx };
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Periodic value noise: wraps at the canvas edge so the texture tiles. */
function tileableNoise(size: number, cells: number, random: () => number): (x: number, y: number) => number {
  const grid = Array.from({ length: cells * cells }, random);
  const cell = size / cells;
  const at = (i: number, j: number) => grid[((j + cells) % cells) * cells + ((i + cells) % cells)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / cell;
    const gy = y / cell;
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    const fx = smooth(gx - i);
    const fy = smooth(gy - j);
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return top + (bottom - top) * fy;
  };
}

/** Tileable 512×512 pool-table cloth: soft mottling, fine grain and a faint weave. */
export function createFeltCanvas(color: string): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(FELT_SIZE, FELT_SIZE);
  if (!ctx) return canvas;
  const random = seeded(0x5eed);
  const broad = tileableNoise(FELT_SIZE, 8, random);
  const fine = tileableNoise(FELT_SIZE, 64, random);
  const [r, g, b] = parseHex(color);
  const image = ctx.createImageData(FELT_SIZE, FELT_SIZE);
  const data = image.data;
  for (let y = 0; y < FELT_SIZE; y += 1) {
    for (let x = 0; x < FELT_SIZE; x += 1) {
      const weave = ((x + y) % 4 < 2 ? 1 : -1) * 0.012;
      const light =
        1 + (broad(x, y) - 0.5) * 0.1 + (fine(x, y) - 0.5) * 0.08 + (random() - 0.5) * 0.06 + weave;
      const offset = (y * FELT_SIZE + x) * 4;
      data[offset] = Math.max(0, Math.min(255, r * light));
      data[offset + 1] = Math.max(0, Math.min(255, g * light));
      data[offset + 2] = Math.max(0, Math.min(255, b * light));
      data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Card back: solid color, faint diamond lattice, thin inner border, small emblem. */
export function createSleeveCanvas(color: string, accent: string = shade(color, 0.35)): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(SLEEVE_WIDTH, SLEEVE_HEIGHT);
  if (!ctx) return canvas;
  const w = SLEEVE_WIDTH;
  const h = SLEEVE_HEIGHT;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, h * 0.7);
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  for (let d = -h; d < w + h; d += 22) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + h, h);
    ctx.moveTo(d, h);
    ctx.lineTo(d + h, 0);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 3;
  roundRect(ctx, 12, 12, w - 24, h - 24, 12);
  ctx.stroke();
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const cx = w / 2;
  const cy = h / 2;
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const px = cx + Math.cos(angle) * 34;
    const py = cy + Math.sin(angle) * 34;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  return canvas;
}

const IDENTITY_TINT: Record<string, string> = {
  W: '#d9d2b6',
  U: '#9fb9d3',
  B: '#9a9290',
  R: '#d6a08a',
  G: '#9fbf9a',
};

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight = '600'): void {
  let current = size;
  ctx.font = `${weight} ${current}px system-ui, sans-serif`;
  while (current > 14 && ctx.measureText(text).width > maxWidth) {
    current -= 2;
    ctx.font = `${weight} ${current}px system-ui, sans-serif`;
  }
}

/** Neutral generic frame with name, type line and P/T, for tokens and cards with no image. */
export function createTokenFaceCanvas(card: ReplayCard): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(FACE_WIDTH, FACE_HEIGHT);
  if (!ctx) return canvas;
  const w = FACE_WIDTH;
  const h = FACE_HEIGHT;
  const colors = (card.color_identity ?? '').toUpperCase().split('').filter((c) => c in IDENTITY_TINT);
  const tint = colors.length === 1 ? IDENTITY_TINT[colors[0]] : colors.length > 1 ? '#cdb77a' : '#bdbab3';

  ctx.fillStyle = '#1c1c1e';
  roundRect(ctx, 0, 0, w, h, 24);
  ctx.fill();
  ctx.fillStyle = tint;
  roundRect(ctx, 18, 18, w - 36, h - 36, 14);
  ctx.fill();

  const art = { x: 40, y: 92, w: w - 80, h: 300 };
  const gradient = ctx.createLinearGradient(art.x, art.y, art.x + art.w, art.y + art.h);
  gradient.addColorStop(0, shade('#5a5f66', 0.15));
  gradient.addColorStop(1, '#2e3238');
  ctx.fillStyle = gradient;
  ctx.fillRect(art.x, art.y, art.w, art.h);
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = '#ffffff';
  for (let r = 30; r < 260; r += 30) {
    ctx.beginPath();
    ctx.arc(art.x + art.w / 2, art.y + art.h / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'middle';
  fitText(ctx, card.name, w - 90, 36, '700');
  ctx.fillText(card.name, 44, 56);
  const typeLine = card.type_line ?? card.primary_type ?? (card.is_token ? 'Token' : '');
  fitText(ctx, typeLine, w - 90, 26, '600');
  ctx.fillText(typeLine, 44, 420);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.fillRect(40, 450, w - 80, 160);
  if (card.is_token) {
    ctx.fillStyle = '#333333';
    fitText(ctx, 'Token', w - 120, 22, '500');
    ctx.fillText('Token', 60, 480);
  }
  if (card.power !== null || card.toughness !== null) {
    const label = `${card.power ?? '?'}/${card.toughness ?? '?'}`;
    ctx.fillStyle = '#f2efe8';
    roundRect(ctx, w - 150, h - 96, 110, 56, 10);
    ctx.fill();
    ctx.fillStyle = '#111111';
    ctx.textAlign = 'center';
    fitText(ctx, label, 96, 34, '700');
    ctx.fillText(label, w - 95, h - 68);
    ctx.textAlign = 'start';
  }
  return canvas;
}
