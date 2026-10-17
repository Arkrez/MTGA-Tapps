/**
 * DOM labels drawn over the canvas: pile counts, and on every face-up
 * battlefield card a readable badge across its lower edge with the creature's
 * current power/toughness or the planeswalker's loyalty (Arena style), plus a
 * small chip across its upper edge for any other counters, or "Commander" on
 * a seat's commander (with its counters after it). Stack items are
 * captioned by the DOM stack preview instead. Pure: computed once per board
 * state; the projector moves them each rendered frame without React.
 */
import { CARD_HEIGHT } from '../layout';
import type { CardPlacement, Layout, PileZone } from '../layout';
import type { CardKey, ReplayCard } from '../types';

export type LabelTone = 'pile' | 'stat' | 'loyalty' | 'counters' | 'commander';

export interface SceneLabel {
  id: string;
  text: string;
  tone: LabelTone;
  /** Follow this mesh's animated pose (offset by x/y/z) when set. */
  obj: string | null;
  x: number;
  y: number;
  z: number;
  align: 'center' | 'start';
  /** A stat badge that differs from the printed card (modified power/toughness). */
  emphasis?: boolean;
}

/** Counter type recorded games use for planeswalker loyalty (replay_capture.COUNTER_TYPE_NAMES). */
export const LOYALTY_COUNTER = 'loyalty';

const PILE_NAMES: Record<PileZone, string> = {
  library: 'Library',
  graveyard: 'Graveyard',
  exile: 'Exile',
  command: 'Command',
};

function rotate(dx: number, dy: number, angle: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [dx * c - dy * s, dx * s + dy * c];
}

function isPlaneswalker(card: ReplayCard | undefined): boolean {
  return `${card?.primary_type ?? ''} ${card?.type_line ?? ''}`.toLowerCase().includes('planeswalker');
}

/** The badge across a card's lower edge: loyalty for a planeswalker, else current power/toughness. */
export function statBadge(
  placement: CardPlacement,
  card: ReplayCard | undefined,
): { text: string; tone: 'stat' | 'loyalty'; emphasis: boolean } | null {
  const loyalty = placement.counters[LOYALTY_COUNTER];
  if (loyalty !== undefined && (isPlaneswalker(card) || placement.power === null)) {
    return { text: String(loyalty), tone: 'loyalty', emphasis: false };
  }
  const printed = card && card.power !== null && card.toughness !== null ? `${card.power}/${card.toughness}` : null;
  if (placement.power !== null && placement.toughness !== null) {
    const current = `${placement.power}/${placement.toughness}`;
    return { text: current, tone: 'stat', emphasis: printed !== null && current !== printed };
  }
  return printed ? { text: printed, tone: 'stat', emphasis: false } : null;
}

/** Counters other than loyalty, as a short chip text ("+1/+1 ×2 · flying"). */
export function countersText(placement: CardPlacement): string | null {
  const parts: string[] = [];
  for (const [type, count] of Object.entries(placement.counters)) {
    if (type === LOYALTY_COUNTER) continue;
    parts.push(count === 1 ? type : `${type} ×${count}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

export function sceneLabels(layout: Layout, cards: Readonly<Record<CardKey, ReplayCard>>): SceneLabel[] {
  const labels: SceneLabel[] = [];
  for (const pile of layout.piles) {
    // An empty command zone keeps its label: it shows where the commander went out from.
    const empty = pile.zone === 'command' && pile.count === 0;
    labels.push({
      id: `pile:${pile.seat}:${pile.zone}`,
      text: empty ? PILE_NAMES[pile.zone] : `${PILE_NAMES[pile.zone]} ${pile.count}`,
      tone: 'pile',
      obj: null,
      // A badge across the lower edge of the pile, so neighbouring piles never collide.
      x: pile.x,
      y: pile.y - (CARD_HEIGHT * pile.scale) / 2 + 0.12,
      z: Math.min(pile.count, 60) * 0.004 + 0.03,
      align: 'center',
    });
  }
  for (const placement of layout.cards) {
    if (placement.zone !== 'battlefield' || !placement.faceUp) continue;
    const card = placement.card ? cards[placement.card] : undefined;
    const badge = statBadge(placement, card);
    if (badge) {
      const [dx, dy] = rotate(0, (-CARD_HEIGHT / 2 + 0.1) * placement.scale, placement.rotZ);
      labels.push({
        id: `stat:${placement.obj}`,
        text: badge.text,
        tone: badge.tone,
        obj: placement.obj,
        x: dx,
        y: dy,
        z: 0.02,
        align: 'center',
        emphasis: badge.emphasis,
      });
    }
    const counters = countersText(placement);
    const chip = placement.commander ? (counters ? `Commander · ${counters}` : 'Commander') : counters;
    if (chip) {
      const [dx, dy] = rotate(0, (CARD_HEIGHT / 2 - 0.1) * placement.scale, placement.rotZ);
      labels.push({
        id: `counters:${placement.obj}`,
        text: chip,
        tone: placement.commander ? 'commander' : 'counters',
        obj: placement.obj,
        x: dx,
        y: dy,
        z: 0.02,
        align: 'center',
      });
    }
  }
  return labels;
}
