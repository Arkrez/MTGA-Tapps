/**
 * Per-viewer replay table preferences (felt, sleeves, camera, toggles) in
 * localStorage `mtga-replay-prefs`. Every storage access is best-effort.
 */
import { PLAYBACK_SPEEDS } from './player';
import type { Pacing, PlaybackSpeed } from './player';

export interface PaletteColor {
  label: string;
  /** Base color. */
  hex: string;
  /** Lighter accent for highlights, borders and patterns. */
  accent: string;
}

export const FELT_COLORS = {
  green: { label: 'Green', hex: '#1f6b4a', accent: '#2f8a62' },
  blue: { label: 'Blue', hex: '#1d4f7a', accent: '#2c6a9e' },
  burgundy: { label: 'Burgundy', hex: '#6a1f2e', accent: '#8a2f42' },
  charcoal: { label: 'Charcoal', hex: '#34383d', accent: '#4a5057' },
  camel: { label: 'Camel', hex: '#9a7444', accent: '#b48d5a' },
  purple: { label: 'Purple', hex: '#4b2a6b', accent: '#643b8c' },
} as const satisfies Record<string, PaletteColor>;

export const SLEEVE_COLORS = {
  navy: { label: 'Navy', hex: '#1b2a4e', accent: '#3a5288' },
  crimson: { label: 'Crimson', hex: '#7a1424', accent: '#b0324a' },
  forest: { label: 'Forest', hex: '#1d4a2c', accent: '#3a7a50' },
  charcoal: { label: 'Charcoal', hex: '#2b2d31', accent: '#55595f' },
  violet: { label: 'Violet', hex: '#4a2378', accent: '#7a4ab4' },
  gold: { label: 'Gold', hex: '#8a6a1c', accent: '#c9a446' },
} as const satisfies Record<string, PaletteColor>;

export type FeltColor = keyof typeof FELT_COLORS;
export type SleeveColor = keyof typeof SLEEVE_COLORS;
export type CameraPreset = 'table' | 'topdown';

export interface ReplayPrefs {
  felt: FeltColor;
  playerSleeve: SleeveColor;
  opponentSleeve: SleeveColor;
  camera: CameraPreset;
  /** Real-table view: opponent cards upside down for you. Off = they face you. */
  mirrorOpponent: boolean;
  /** Show opponent hand cards face-up once the game reveals them later (recorded games). */
  hindsight: boolean;
  pacing: Pacing;
  speed: PlaybackSpeed;
  /** Actions panel collapsed to a slim rail (its width goes to the table). */
  logCollapsed: boolean;
}

export const PREFS_STORAGE_KEY = 'mtga-replay-prefs';

export const DEFAULT_PREFS: Readonly<ReplayPrefs> = Object.freeze({
  felt: 'green',
  playerSleeve: 'navy',
  opponentSleeve: 'crimson',
  camera: 'table',
  mirrorOpponent: false,
  hindsight: true,
  pacing: 'paced',
  speed: 1,
  logCollapsed: false,
});

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Coerces untrusted input; unknown or missing values fall back to defaults. */
export function normalizePrefs(raw: unknown): ReplayPrefs {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const felts = Object.keys(FELT_COLORS) as FeltColor[];
  const sleeves = Object.keys(SLEEVE_COLORS) as SleeveColor[];
  return {
    felt: pick(input.felt, felts, DEFAULT_PREFS.felt),
    playerSleeve: pick(input.playerSleeve, sleeves, DEFAULT_PREFS.playerSleeve),
    opponentSleeve: pick(input.opponentSleeve, sleeves, DEFAULT_PREFS.opponentSleeve),
    camera: pick<CameraPreset>(input.camera, ['table', 'topdown'], DEFAULT_PREFS.camera),
    mirrorOpponent: typeof input.mirrorOpponent === 'boolean' ? input.mirrorOpponent : DEFAULT_PREFS.mirrorOpponent,
    hindsight: typeof input.hindsight === 'boolean' ? input.hindsight : DEFAULT_PREFS.hindsight,
    pacing: pick<Pacing>(input.pacing, ['paced', 'realtime'], DEFAULT_PREFS.pacing),
    speed: pick(input.speed, PLAYBACK_SPEEDS, DEFAULT_PREFS.speed),
    logCollapsed: typeof input.logCollapsed === 'boolean' ? input.logCollapsed : DEFAULT_PREFS.logCollapsed,
  };
}

/** Last saved value, used when storage is unavailable so changes last for the page. */
let memoryPrefs: ReplayPrefs | null = null;

export function loadPrefs(): ReplayPrefs {
  let raw: string | null;
  try {
    raw = localStorage.getItem(PREFS_STORAGE_KEY);
  } catch {
    return memoryPrefs ? { ...memoryPrefs } : { ...DEFAULT_PREFS };
  }
  try {
    return normalizePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

type PrefsListener = (prefs: ReplayPrefs) => void;
const listeners = new Set<PrefsListener>();

function notify(prefs: ReplayPrefs): void {
  for (const listener of [...listeners]) listener(prefs);
}

/** Validates, persists (best-effort) and notifies subscribers; returns what was saved. */
export function savePrefs(prefs: Partial<ReplayPrefs>): ReplayPrefs {
  const next = normalizePrefs({ ...loadPrefs(), ...prefs });
  memoryPrefs = next;
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: keep the in-memory change for this page.
  }
  notify(next);
  return next;
}

function onStorage(event: StorageEvent): void {
  if (event.key === PREFS_STORAGE_KEY) notify(loadPrefs());
}

/** Called on local saves and on changes made in other tabs. Returns unsubscribe. */
export function subscribePrefs(listener: PrefsListener): () => void {
  if (!listeners.size && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}
