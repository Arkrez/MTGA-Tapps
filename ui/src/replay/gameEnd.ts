/**
 * Pure description of how a replay ended, for the ending screen and the HUD
 * chip. The winner comes from the applied `game_end` event when it names a
 * seat, otherwise from the game row's outcome.
 */
import type { BoardState } from './reducer';
import type { ReplayStream } from './types';

export type GameEndResult = 'win' | 'loss' | 'draw' | 'unknown';

export interface GameEndSummary {
  result: GameEndResult;
  /** "Victory", "Defeat", "Draw" or "Game over". */
  headline: string;
  /** Human sentence for the reason, or null when Arena gave none. */
  reason: string | null;
}

const HEADLINES: Record<GameEndResult, string> = {
  win: 'Victory',
  loss: 'Defeat',
  draw: 'Draw',
  unknown: 'Game over',
};

/**
 * Reasons stored on games rows are already sentences ("Opponent reached 0
 * life"); recorded `game_end` events may carry Arena's bare codes instead.
 */
export function endReasonLabel(reason: string | null | undefined, result: GameEndResult): string | null {
  if (!reason) return null;
  const code = reason.replace(/^ResultReason_/i, '').trim();
  if (!code) return null;
  const won = result === 'win';
  switch (code.toLowerCase()) {
    case 'concede':
    case 'conceded':
      return won ? 'Opponent conceded' : 'You conceded';
    case 'game':
    case 'zerolife':
    case 'reachedzerolife':
      return won ? 'Opponent reached 0 life' : 'You reached 0 life';
    case 'timeout':
    case 'timedout':
      return won ? 'Opponent timed out' : 'You timed out';
    case 'disconnect':
    case 'disconnected':
      return won ? 'Opponent disconnected' : 'You disconnected';
    case 'drawfromemptylib':
    case 'drawfromemptylibrary':
      return won ? 'Opponent drew from an empty library' : 'You drew from an empty library';
    case 'draw':
      return 'The game was a draw';
    default:
      return code.replace(/\bDrawFromEmptyLib\b/, 'drawing from an empty library');
  }
}

export function describeGameEnd(stream: ReplayStream, state: BoardState): GameEndSummary {
  let result: GameEndResult;
  if (state.winnerSeat !== null) {
    result = state.winnerSeat === stream.player_seat ? 'win' : 'loss';
  } else if (stream.game.outcome === 'win' || stream.game.outcome === 'loss' || stream.game.outcome === 'draw') {
    result = stream.game.outcome;
  } else {
    result = 'unknown';
  }
  const eventReason = state.lastEvent?.kind === 'game_end' ? state.lastEvent.reason : null;
  const reason = endReasonLabel(eventReason ?? stream.game.outcome_reason, result);
  return { result, headline: HEADLINES[result], reason };
}
