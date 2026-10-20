/**
 * 17lands card ratings for the Draft Replay heat map. 17lands publishes
 * per-card draft statistics keyed by Arena id (`mtga_id`) and allows browser
 * requests. The viewer shows "games in hand" win rate (GIH WR,
 * `ever_drawn_win_rate`), the number drafters usually rank picks by.
 *
 * Small samples come back null, so ratings merge several sources, first
 * non-null wins: the draft's own format, then Premier Draft (the largest
 * sample), for the base set and its Alchemy "Y" set. Answers are cached in
 * localStorage for 12 hours; a failed fetch just leaves cards unrated.
 */
import { useEffect, useState } from 'react';
import type { DraftInfo, DraftStream } from './types';

export interface CardRating {
  /** Games-in-hand win rate, 0–1. */
  gihWr: number | null;
  /** Average pick position (17lands "ATA"/avg_pick), when published. */
  avgPick: number | null;
  /** Number of games the win rate is based on. */
  games: number;
}

export interface Ratings {
  byArenaId: Map<number, CardRating>;
  /** Mean and spread of the rated cards' GIH WR, for the heat-map scale. */
  mean: number;
  spread: number;
  /** Human label of the sources used, e.g. "FRA Premier Draft". */
  source: string;
}

const API = 'https://www.17lands.com/card_ratings/data';
const CACHE_PREFIX = 'tapps.17lands.v1.';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const START_DATE = '2020-01-01';

const FORMAT_LABELS: Record<string, string> = {
  PremierDraft: 'Premier Draft',
  QuickDraft: 'Quick Draft',
  TradDraft: 'Traditional Draft',
  PickTwoDraft: 'Pick Two Draft',
};

/** 17lands format for an Arena draft event; qualifiers and unknown events use Premier Draft. */
export function seventeenLandsFormat(draft: Pick<DraftInfo, 'event_name' | 'kind'>): string {
  const event = draft.event_name ?? '';
  for (const format of ['PremierDraft', 'QuickDraft', 'TradDraft', 'PickTwoDraft']) {
    if (event.startsWith(format)) return format;
  }
  if (/^Trad/i.test(event)) return 'TradDraft';
  if (draft.kind === 'bot' || /bot_?draft/i.test(event)) return 'QuickDraft';
  return 'PremierDraft';
}

/**
 * 17lands expansions to read: the set most of the draft's cards come from,
 * plus its Alchemy companion (`Y26FRA`) when the event or cards point to one.
 */
export function seventeenLandsExpansions(stream: Pick<DraftStream, 'cards' | 'draft'>): string[] {
  const counts = new Map<string, number>();
  for (const card of Object.values(stream.cards)) {
    const set = card.set_code?.toUpperCase();
    if (set && /^[A-Z0-9]{3}$/.test(set) && !/^Y\d\d$/.test(set)) counts.set(set, (counts.get(set) ?? 0) + 1);
  }
  const base = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!base) return [];
  const alchemy = /^(Y\d\d)_/.exec(stream.draft.event_name ?? '')?.[1]
    ?? Object.values(stream.cards).map((card) => card.set_code?.toUpperCase() ?? '').find((set) => /^Y\d\d$/.test(set));
  return alchemy ? [base, `${alchemy}${base}`] : [base];
}

interface RawRating {
  mtga_id?: number;
  ever_drawn_win_rate?: number | null;
  avg_pick?: number | null;
  ever_drawn_game_count?: number | null;
}

/** Merges sources in priority order: a card keeps the first non-null win rate it gets. */
export function mergeRatings(sources: RawRating[][]): Map<number, CardRating> {
  const out = new Map<number, CardRating>();
  for (const rows of sources) {
    for (const row of rows) {
      if (typeof row.mtga_id !== 'number') continue;
      const existing = out.get(row.mtga_id);
      if (existing?.gihWr != null) continue;
      out.set(row.mtga_id, {
        gihWr: typeof row.ever_drawn_win_rate === 'number' ? row.ever_drawn_win_rate : null,
        avgPick: existing?.avgPick ?? (typeof row.avg_pick === 'number' ? row.avg_pick : null),
        games: row.ever_drawn_game_count ?? 0,
      });
    }
  }
  return out;
}

export function ratingStats(byArenaId: ReadonlyMap<number, CardRating>): { mean: number; spread: number } {
  const rates = [...byArenaId.values()].map((r) => r.gihWr).filter((r): r is number => r != null);
  if (!rates.length) return { mean: 0.55, spread: 0.03 };
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length;
  return { mean, spread: Math.max(0.01, Math.sqrt(variance)) };
}

/**
 * Heat-map color for a win rate: red two spreads below the set's mean,
 * amber at the mean, green two spreads above (hue 0 → 45 → 130).
 */
export function heatColor(gihWr: number, mean: number, spread: number): string {
  const z = Math.max(-2, Math.min(2, (gihWr - mean) / spread));
  const hue = z < 0 ? 45 + z * 22.5 : 45 + z * 42.5;
  return `hsl(${Math.round(hue)} 85% 52%)`;
}

export function formatWinRate(gihWr: number): string {
  return `${(gihWr * 100).toFixed(1)}%`;
}

async function fetchSource(expansion: string, format: string, signal: AbortSignal): Promise<RawRating[]> {
  const cacheKey = `${CACHE_PREFIX}${expansion}.${format}`;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) ?? 'null') as { at: number; rows: RawRating[] } | null;
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;
  } catch {
    // Unreadable cache: fetch again.
  }
  const params = new URLSearchParams({ expansion, format, start_date: START_DATE });
  const response = await fetch(`${API}?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`17lands returned ${response.status}`);
  const body = (await response.json()) as RawRating[];
  const rows = (Array.isArray(body) ? body : []).map((row) => ({
    mtga_id: row.mtga_id,
    ever_drawn_win_rate: row.ever_drawn_win_rate ?? null,
    avg_pick: row.avg_pick ?? null,
    ever_drawn_game_count: row.ever_drawn_game_count ?? 0,
  }));
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), rows }));
  } catch {
    // Storage full or blocked: the in-memory answer still works.
  }
  return rows;
}

/** 17lands ratings for this draft, or null until loaded (or when disabled / unavailable). */
export function useSeventeenLandsRatings(stream: DraftStream, enabled: boolean): Ratings | null {
  const [ratings, setRatings] = useState<{ stream: DraftStream; ratings: Ratings } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const format = seventeenLandsFormat(stream.draft);
    const formats = format === 'PremierDraft' ? [format] : [format, 'PremierDraft'];
    const expansions = seventeenLandsExpansions(stream);
    const sources = expansions.flatMap((expansion) => formats.map((f) => ({ expansion, format: f })));
    void Promise.all(
      sources.map((source) => fetchSource(source.expansion, source.format, controller.signal).catch(() => [] as RawRating[])),
    ).then((rows) => {
      if (controller.signal.aborted) return;
      const byArenaId = mergeRatings(rows);
      if (![...byArenaId.values()].some((r) => r.gihWr != null)) return;
      const label = `${expansions[0]} ${formats.map((f) => FORMAT_LABELS[f] ?? f).join(' + ')}`;
      setRatings({ stream, ratings: { byArenaId, ...ratingStats(byArenaId), source: label } });
    });
    return () => controller.abort();
  }, [enabled, stream]);
  return enabled && ratings?.stream === stream ? ratings.ratings : null;
}
