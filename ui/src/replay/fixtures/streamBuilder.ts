/** Test-only helper that assembles valid replay streams event by event. */
import type {
  CardKey,
  MoveReason,
  ObjId,
  ReplayCard,
  ReplayEvent,
  ReplayEventBase,
  ReplayEventKind,
  ReplayEventOf,
  ReplayFidelity,
  ReplayStream,
  ReplayTurn,
  Zone,
} from '../types';

export type EventFields<K extends ReplayEventKind> = Omit<
  ReplayEventOf<K>,
  keyof ReplayEventBase | 'kind'
>;

export function card(
  name: string,
  primaryType: string,
  extra: Partial<ReplayCard> = {},
): ReplayCard {
  return {
    name,
    arena_id: null,
    type_line: primaryType,
    primary_type: primaryType,
    power: null,
    toughness: null,
    mana_cost: null,
    color_identity: null,
    is_token: false,
    image_url: null,
    faces: [],
    ...extra,
  };
}

export class StreamBuilder {
  readonly events: ReplayEvent[] = [];
  private t = 0;
  private turn = 0;
  private phase: string | null = null;
  private step: string | null = null;

  add<K extends ReplayEventKind>(
    kind: K,
    fields: EventFields<K>,
    opts: { dt?: number; text?: string } = {},
  ): this {
    this.t += opts.dt ?? 1;
    if (kind === 'turn') {
      this.phase = 'Phase_Beginning';
      this.step = null;
    }
    const base: ReplayEventBase = {
      seq: this.events.length,
      t: Math.round(this.t * 100) / 100,
      turn: this.turn,
      phase: this.phase,
      step: this.step,
      log: opts.text ? { text: opts.text, segments: [{ text: opts.text }] } : null,
    };
    this.events.push({ ...base, kind, ...fields } as unknown as ReplayEvent);
    return this;
  }

  turnStart(turn: number, activeSeat: number): this {
    this.turn = turn;
    return this.add('turn', { active_seat: activeSeat }, { text: `Turn ${turn}`, dt: 2 });
  }

  phaseTo(phase: string, step: string | null = null): this {
    this.phase = phase;
    this.step = step;
    return this.add('phase', {}, { dt: 0.5 });
  }

  move(
    obj: ObjId,
    cardKey: CardKey | null,
    from: Zone,
    to: Zone,
    owner: number,
    reason: MoveReason,
    opts: { controller?: number; inferred?: boolean; index?: number | null; with?: ObjId | null; dt?: number } = {},
  ): this {
    return this.add(
      'move',
      {
        obj,
        card: cardKey,
        from,
        to,
        owner,
        controller: opts.controller ?? owner,
        reason,
        inferred: opts.inferred ?? false,
        index: opts.index ?? null,
        with: opts.with ?? null,
      },
      { dt: opts.dt },
    );
  }

  /** Spell cast: hand -> stack move followed by its stack_push. */
  cast(obj: ObjId, cardKey: CardKey, seat: number, stackId: string, targets: ObjId[] = []): this {
    this.move(obj, cardKey, 'hand', 'stack', seat, 'cast');
    return this.add(
      'stack_push',
      { stack_id: stackId, obj, card: cardKey, stack_kind: 'spell', controller: seat, text: null, targets },
      { text: `cast ${cardKey}` },
    );
  }

  /** stack_resolve followed by the spell's move off the stack. */
  resolve(obj: ObjId, cardKey: CardKey, seat: number, stackId: string, to: Zone): this {
    this.add('stack_resolve', { stack_id: stackId }, { text: 'resolved' });
    return this.move(obj, cardKey, 'stack', to, seat, 'resolve');
  }

  build(
    cards: Record<CardKey, ReplayCard>,
    opts: { playerSeat: number; fidelity?: ReplayFidelity; firstSeat?: number },
  ): ReplayStream {
    const opponentSeat = opts.playerSeat === 1 ? 2 : 1;
    const firstSeat = opts.firstSeat ?? opts.playerSeat;
    const seat = (role: 'player' | 'opponent', id: number) => ({
      role,
      name: role === 'player' ? 'You' : 'Opponent',
      deck_name: role === 'player' ? 'Test Deck' : null,
      starting_life: 20,
      went_first: id === firstSeat,
      commanders: [],
      deck_size: 60,
      colors: null,
    });
    const last = this.events[this.events.length - 1];
    return {
      version: 1,
      fidelity: opts.fidelity ?? 'recorded',
      replay_version: opts.fidelity === 'reconstructed' ? null : 1,
      limitations: [],
      game: {
        id: 'fixture-game',
        started_at: '2026-10-06T12:00:00',
        ended_at: null,
        format: 'Standard Ranked',
        best_of: 1,
        game_number: 1,
        outcome: 'unknown',
        outcome_reason: null,
        winner_seat: null,
        total_turns: this.turn,
        duration_seconds: last ? last.t : 0,
      },
      player_seat: opts.playerSeat,
      seats: {
        [String(opts.playerSeat)]: seat('player', opts.playerSeat),
        [String(opponentSeat)]: seat('opponent', opponentSeat),
      },
      cards,
      turns: buildTurns(this.events),
      events: this.events,
    };
  }
}

export function buildTurns(events: readonly ReplayEvent[]): ReplayTurn[] {
  const turns: ReplayTurn[] = [];
  for (const event of events) {
    if (event.kind !== 'turn') continue;
    const previous = turns[turns.length - 1];
    if (previous) previous.last_seq = event.seq - 1;
    turns.push({
      turn: event.turn,
      seat: event.active_seat,
      first_seq: event.seq,
      last_seq: event.seq,
      started_at: null,
      duration_seconds: null,
    });
  }
  const lastTurn = turns[turns.length - 1];
  if (lastTurn && events.length) lastTurn.last_seq = events[events.length - 1].seq;
  return turns;
}
