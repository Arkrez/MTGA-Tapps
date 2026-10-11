/**
 * Small procedural canvases used by the scene: the rounded-corner alpha mask
 * shared by every card, the soft card shadow, highlight rings, the dashed
 * "inferred" outline and the "?" back for unknown cards. Like materials.ts,
 * each returns a blank canvas when no 2D context exists (jsdom).
 */
import { createSleeveCanvas } from '../materials';

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: context2d(canvas) };
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** White rounded rectangle on black: alphaMap for card corners (Scryfall radius ≈ 4.75%). */
export function createCardAlphaCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d(128, 178);
  if (!ctx) return canvas;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 128, 178);
  ctx.fillStyle = '#fff';
  roundRectPath(ctx, 0, 0, 128, 178, 7);
  ctx.fill();
  return canvas;
}

/** Soft blurred shadow; the plane using it is larger than the card. */
export function createShadowCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d(128, 160);
  if (!ctx) return canvas;
  ctx.filter = 'blur(10px)';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  roundRectPath(ctx, 26, 26, 76, 108, 8);
  ctx.fill();
  return canvas;
}

/** White rounded outline used for highlight rings (tinted by the material color). */
export function createRingCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d(160, 214);
  if (!ctx) return canvas;
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 11;
  roundRectPath(ctx, 14, 14, 132, 186, 12);
  ctx.stroke();
  ctx.stroke();
  return canvas;
}

/** Dashed outline with an "inferred" tag below the card. */
export function createInferredCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d(160, 250);
  if (!ctx) return canvas;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 8]);
  roundRectPath(ctx, 8, 8, 144, 200, 10);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(16, 20, 24, 0.82)';
  roundRectPath(ctx, 34, 214, 92, 28, 8);
  ctx.fill();
  ctx.fillStyle = '#e8eef5';
  ctx.font = '600 18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('inferred', 80, 229);
  return canvas;
}

/** Faint outline marking an empty pile slot on the felt. */
export function createSlotCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d(128, 178);
  if (!ctx) return canvas;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = 3;
  roundRectPath(ctx, 4, 4, 120, 170, 8);
  ctx.stroke();
  return canvas;
}

/** Sleeve back with a "?" badge for cards the stream could not identify. */
export function createUnknownCanvas(color: string, accent: string): HTMLCanvasElement {
  const canvas = createSleeveCanvas(color, accent);
  const ctx = context2d(canvas);
  if (!ctx) return canvas;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f4f1ea';
  ctx.font = '700 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', cx, cy + 3);
  return canvas;
}

/**
 * Soft darkening toward the felt's edges: an opaque grey ramp read as an
 * alphaMap (green channel) by a black material, so the cloth reads as lit
 * from above and the cards pop off it.
 */
export function createVignetteCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d(256, 256);
  if (!ctx) return canvas;
  const g = ctx.createRadialGradient(128, 128, 40, 128, 128, 182);
  g.addColorStop(0, 'rgb(0, 0, 0)');
  g.addColorStop(0.55, 'rgb(28, 28, 28)');
  g.addColorStop(1, 'rgb(140, 140, 140)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return canvas;
}
