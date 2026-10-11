/**
 * Deterministic synthetic game for performance tests: every turn the active
 * seat draws a land and a creature, plays both, attacks, trades one creature,
 * and pads the turn with taps, counters and notes to `eventsPerTurn`.
 */
import type { ObjId, ReplayStream } from '../types';
import { StreamBuilder, card } from './streamBuilder';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CARDS = {
  a1: card('Forest', 'Land', { arena_id: 1 }),
  a2: card('Grizzly Bears', 'Creature', { arena_id: 2, power: '2', toughness: '2' }),
  'n:Saproling': card('Saproling', 'Creature', { power: '1', toughness: '1', is_token: true }),
};

export function makeLongStream(turns: number, eventsPerTurn: number, seed = 7): ReplayStream {
  const random = rng(seed);
  const b = new StreamBuilder();
  let nextId = 1000;
  const id = (): ObjId => String(nextId++);
  const hands: Record<number, ObjId[]> = { 1: [], 2: [] };
  const lands: Record<number, ObjId[]> = { 1: [], 2: [] };
  const creatures: Record<number, ObjId[]> = { 1: [], 2: [] };
  const known = (seat: number, key: string) => (seat === 1 ? key : null);

  b.add('game_start', { seats_hand_sizes: { 1: 7, 2: 7 }, library_sizes: { 1: 53, 2: 53 } }, { dt: 0 });
  for (const seat of [1, 2]) {
    for (let i = 0; i < 7; i += 1) {
      const obj = id();
      hands[seat].push(obj);
      b.move(obj, known(seat, i % 2 ? 'a2' : 'a1'), 'library', 'hand', seat, 'draw', { dt: 0 });
    }
  }
  let stackId = 0;
  for (let turn = 1; turn <= turns; turn += 1) {
    const seat = turn % 2 ? 1 : 2;
    const foe = seat === 1 ? 2 : 1;
    const start = b.events.length;
    b.turnStart(turn, seat);
    b.add('untap', { objs: [...lands[seat], ...creatures[seat]] });
    const land = id();
    const creature = id();
    b.move(land, known(seat, 'a1'), 'library', 'hand', seat, 'draw');
    b.move(creature, known(seat, 'a2'), 'library', 'hand', seat, 'draw');
    b.phaseTo('Phase_Main1');
    b.move(land, 'a1', 'hand', 'battlefield', seat, 'play_land');
    lands[seat].push(land);
    b.add('tap', { objs: lands[seat].slice(-2) });
    const sid = `s${++stackId}`;
    b.cast(creature, 'a2', seat, sid);
    b.resolve(creature, 'a2', seat, sid, 'battlefield');
    const attackers = creatures[seat].slice(0, 3);
    creatures[seat].push(creature);
    if (turn % 6 === 0) {
      const token = id();
      b.move(token, 'n:Saproling', 'limbo', 'battlefield', seat, 'token_create');
      creatures[seat].push(token);
    }
    if (attackers.length) {
      b.phaseTo('Phase_Combat', 'Step_DeclareAttack');
      b.add('attack', { seat, objs: attackers, target_seat: foe, target_obj: null });
      const blocker = creatures[foe][0];
      if (blocker) {
        b.add('block', { seat: foe, pairs: [{ blocker, attacker: attackers[0] }] });
        b.add('damage', { source: attackers[0], target_obj: blocker, target_seat: null, amount: 2, combat: true });
        b.move(blocker, null, 'battlefield', 'graveyard', foe, 'sba');
        creatures[foe].shift();
      }
      b.add('damage', { source: null, target_obj: null, target_seat: foe, amount: 2, combat: true });
      b.add('life', { seat: foe, life: 20 - turn, delta: -2, source_obj: null });
      b.phaseTo('Phase_Main2');
    }
    while (b.events.length - start < eventsPerTurn) {
      const pool = creatures[seat];
      const roll = random();
      if (pool.length && roll < 0.35) {
        const target = pool[Math.floor(random() * pool.length)];
        b.add('counter', { obj: target, type: '+1/+1', delta: 1, total: null }, { dt: 0.2 });
      } else if (pool.length && roll < 0.55) {
        const target = pool[Math.floor(random() * pool.length)];
        b.add('pt', { obj: target, power: 3, toughness: 3 }, { dt: 0.2 });
      } else if (roll < 0.8 && lands[seat].length) {
        b.add(roll < 0.7 ? 'tap' : 'untap', { objs: [lands[seat][0]] }, { dt: 0.2 });
      } else {
        b.add('note', {}, { text: 'filler', dt: 0.2 });
      }
    }
  }
  return b.build(CARDS, { playerSeat: 1 });
}
