/**
 * 17lands card ratings for the Draft Replay heat map. The tracker downloads
 * 17lands' per-card data (keyed by Arena id), keeps it on disk next to its
 * database and refreshes it at most daily (`GET /api/card-ratings`,
 * src/mtga_tracker/card_ratings.py), so ratings work offline and later.
 *
 * Only games-in-hand win rate (GIH WR) is shown. Sources merge in priority
 * order, first published rate wins: the draft's own format, then Premier
 * Draft (the largest sample), for the base set and its Alchemy "Y" set.
 * Cards 17lands has not rated yet stay unrated (grey), never substituted.
 */
import { useEffect, useState } from 'react';
import type { DraftInfo, DraftStream } from './types';

export interface CardRating {
  /** Games-in-hand win rate, 0–1; null until 17lands publishes one. */
  gihWr: number | null;
  /** Games in hand 17lands has seen for the card. */
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

interface RatingsResponse {
  cards?: Record<string, { gih_wr: number | null; games: number }>;
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
    if (!expansions.length) return;
    const params = new URLSearchParams({ expansions: expansions.join(','), formats: formats.join(',') });
    fetch(`/api/card-ratings?${params.toString()}`, { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<RatingsResponse>) : null))
      .then((body) => {
        if (!body?.cards || controller.signal.aborted) return;
        const byArenaId = new Map<number, CardRating>();
        for (const [id, card] of Object.entries(body.cards)) {
          byArenaId.set(Number(id), { gihWr: card.gih_wr ?? null, games: card.games ?? 0 });
        }
        if (![...byArenaId.values()].some((r) => r.gihWr != null)) return;
        const label = `${expansions[0]} ${formats.map((f) => FORMAT_LABELS[f] ?? f).join(' + ')}`;
        setRatings({ stream, ratings: { byArenaId, ...ratingStats(byArenaId), source: label } });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [enabled, stream]);
  return enabled && ratings?.stream === stream ? ratings.ratings : null;
}
