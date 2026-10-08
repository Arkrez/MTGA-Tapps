/** Tiny external store for the hovered card, so pointer moves re-render only the preview. */
import type { CardKey } from '../types';

export interface HoverInfo {
  key: string;
  card: CardKey | null;
  name: string;
  /** Viewport coordinates of the pointer or the anchor's edge. */
  x: number;
  y: number;
  /** 'scene': follow the pointer; 'log': open to the left of the anchor. */
  source: 'scene' | 'log';
}

export class HoverStore {
  private current: HoverInfo | null = null;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly get = (): HoverInfo | null => this.current;

  set(info: HoverInfo | null): void {
    const prev = this.current;
    if (prev === info) return;
    if (prev && info && prev.key === info.key && prev.x === info.x && prev.y === info.y) return;
    this.current = info;
    for (const listener of [...this.listeners]) listener();
  }

  /** Clears only when `key` is still the hovered item (pointer-out ordering is not guaranteed). */
  clear(key: string): void {
    if (this.current?.key === key) this.set(null);
  }
}

const GAP = 16;
const EDGE = 12;

/** Fixed-position box for the preview: beside the pointer (scene) or left of the log. */
export function previewPosition(info: HoverInfo, viewport: { width: number; height: number }) {
  const width = Math.min(300, Math.max(240, viewport.width * 0.22));
  const height = (width - 10) * (680 / 488) + 10;
  let left: number;
  let top: number;
  if (info.source === 'log') {
    left = info.x - GAP - width;
    top = info.y - height / 2;
  } else {
    left = info.x + GAP;
    if (left + width > viewport.width - EDGE) left = info.x - GAP - width;
    top = info.y - height * 0.4;
  }
  left = Math.max(EDGE, Math.min(left, viewport.width - width - EDGE));
  top = Math.max(EDGE, Math.min(top, viewport.height - height - EDGE));
  return { left, top, width };
}

