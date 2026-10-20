import { describe, expect, it } from 'vitest';
import { cardRouteHash, gameRouteHash, parseCardRoute, parseGameRoute } from './routes';

describe('detail route return context', () => {
  it('round-trips a timeline card route back to the same game timeline', () => {
    const gameHash = gameRouteHash('game:1', '#recent-games', 'game-timeline');
    const cardHash = cardRouteHash('Sheltered by Ghosts', gameHash);

    expect(parseCardRoute(cardHash)).toEqual({
      name: 'Sheltered by Ghosts',
      returnHash: gameHash,
      filters: {},
    });
    expect(parseGameRoute(gameHash)).toEqual({
      id: 'game:1',
      returnHash: '#recent-games',
      focusId: 'game-timeline',
    });
  });

  it('round-trips a card back to Deck Manager', () => {
    expect(parseCardRoute(cardRouteHash('Forest', '#/deck-manager'))?.returnHash).toBe('#/deck-manager');
  });

  it('rejects external return locations on card routes', () => {
    expect(parseCardRoute('#/card/Swamp?return=https%3A%2F%2Fexample.com')).toEqual({
      name: 'Swamp',
      returnHash: '#overview',
      filters: {},
    });
  });
});


describe('filter round-trips', () => {
  it('carries season and date-range filters through the dashboard route', async () => {
    const { dashboardRouteHash, parseDashboardRouteFilters } = await import('./routes');
    const hash = dashboardRouteHash({
      deck: 'Boros Mouse',
      format: 'Play',
      days: 30,
      season: 91,
      since: '2026-06-01',
      until: '2026-06-30',
    });
    expect(parseDashboardRouteFilters(hash)).toEqual({
      deck: 'Boros Mouse',
      format: 'Play',
      days: 30,
      season: 91,
      since: '2026-06-01',
      until: '2026-06-30',
    });
  });

  it('parses opponent routes with filters', async () => {
    const { parseOpponentRoute } = await import('./routes');
    expect(parseOpponentRoute('#/opponent/Foe?format=Play&days=7')).toEqual({
      name: 'Foe',
      filters: { format: 'Play', days: 7 },
    });
  });

  it('drops malformed date filters', async () => {
    const { parseDashboardRouteFilters } = await import('./routes');
    expect(parseDashboardRouteFilters('#overview?since=yesterday&until=2026-13-99x')).toEqual({});
  });
});

describe('all-games route', () => {
  it('round-trips filters through the games route', async () => {
    const { gamesRouteHash, parseGamesRoute } = await import('./routes');
    expect(parseGamesRoute('#/games')).toEqual({ filters: {} });
    const hash = gamesRouteHash({ deck: 'Boros Mouse', days: 30 });
    expect(parseGamesRoute(hash)).toEqual({ filters: { deck: 'Boros Mouse', days: 30 } });
    expect(parseGamesRoute('#/game/abc')).toBeNull();
  });
});

describe('replay routes', () => {
  it('parses the replay list route', async () => {
    const { parseReplayRoute, replayRouteHash } = await import('./routes');
    expect(replayRouteHash()).toBe('#/replay');
    expect(parseReplayRoute('#/replay')).toEqual({ gameId: null, at: null, row: null, returnHash: null });
    expect(parseReplayRoute('#/replay/')).toEqual({ gameId: null, at: null, row: null, returnHash: null });
    expect(parseReplayRoute('#/replays')).toBeNull();
    expect(parseReplayRoute('#/game/abc')).toBeNull();
  });

  it('round-trips a game replay with seq and return hash', async () => {
    const { gameRouteHash, parseReplayRoute, replayRouteHash } = await import('./routes');
    const back = gameRouteHash('game:1', '#recent-games');
    const hash = replayRouteHash('game:1/2', { at: 42, returnHash: back });
    expect(parseReplayRoute(hash)).toEqual({ gameId: 'game:1/2', at: 42, row: null, returnHash: back });
    expect(parseReplayRoute(replayRouteHash('g', { at: 0 }))).toEqual({ gameId: 'g', at: 0, row: null, returnHash: null });
  });

  it('round-trips a timeline row deep link', async () => {
    const { gameRouteHash, parseReplayRoute, replayRouteHash } = await import('./routes');
    const back = gameRouteHash('g1', '#overview');
    const hash = replayRouteHash('g1', { row: 1234, returnHash: back });
    expect(hash).toBe(`#/replay/g1?row=1234&return=${encodeURIComponent(back)}`);
    expect(parseReplayRoute(hash)).toEqual({ gameId: 'g1', at: null, row: 1234, returnHash: back });
    expect(parseReplayRoute('#/replay/g1?at=5&row=9')).toMatchObject({ at: 5, row: 9 });
    expect(parseReplayRoute('#/replay/g1?row=abc')?.row).toBeNull();
    expect(parseReplayRoute('#/replay/g1?row=-2')?.row).toBeNull();
    expect(replayRouteHash('g1', { row: null })).toBe('#/replay/g1');
    expect(replayRouteHash('g1', { row: 1.5 })).toBe('#/replay/g1');
  });

  it('round-trips a draft replay and keeps it out of the game replay route', async () => {
    const { draftReplayRouteHash, parseDraftReplayRoute, parseReplayRoute } = await import('./routes');
    const hash = draftReplayRouteHash('bot-c/1', { step: 'p2p9', returnHash: '#/replay' });
    expect(hash).toBe(`#/replay/draft/bot-c%2F1?step=p2p9&return=${encodeURIComponent('#/replay')}`);
    expect(parseDraftReplayRoute(hash)).toEqual({ draftId: 'bot-c/1', step: 'p2p9', returnHash: '#/replay' });
    expect(parseReplayRoute(hash)).toBeNull();
    expect(parseDraftReplayRoute('#/replay/draft/d?step=nine&return=https%3A%2F%2Fx')).toEqual({
      draftId: 'd',
      step: null,
      returnHash: null,
    });
    expect(parseDraftReplayRoute('#/replay/draft/')).toBeNull();
    expect(parseDraftReplayRoute('#/replay/g1')).toBeNull();
    expect(draftReplayRouteHash('d', { step: 'bad' })).toBe('#/replay/draft/d');
  });

  it('drops malformed seq and non-hash return targets', async () => {
    const { parseReplayRoute, replayRouteHash } = await import('./routes');
    expect(parseReplayRoute('#/replay/g?at=-3&return=https%3A%2F%2Fexample.com')).toEqual({
      gameId: 'g',
      at: null,
      row: null,
      returnHash: null,
    });
    expect(parseReplayRoute('#/replay/g?at=1.5')?.at).toBeNull();
    expect(replayRouteHash('g', { at: -1, returnHash: 'https://x' })).toBe('#/replay/g');
  });
});
