import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGameRecord, type GameRecord } from '../src/server/gameRecord.js';
import { handlePresidentLegislation, handleChancellorLegislation } from '../src/server/phases/legislation.js';
import { deck, fakeClient } from './helpers.js';

const noop = () => {};

// Failed requests are logged to the console on purpose; keep test output clean
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

// President P0 and Chancellor P1 elected; the deck is drawn in the given order
function electedGame(drawPile = deck('F', 'L', 'F', 'L', 'L', 'L')): GameRecord {
  const players = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, model: 'fake' }));
  const game = createGameRecord(`test-${Math.random()}`, players, null, {});
  game.state = { ...game.state, phase: 'legislation_president', presidentIndex: 0, chancellorIndex: 1, drawPile };
  return game;
}

const eventsOf = (game: GameRecord, type: string) => game.history.events.filter((e) => e.type === type).map((e) => e.data);
const lastMessage = (game: GameRecord, playerId: string) => game.playerMessages.get(playerId)!.at(-1)!.content;

describe('president legislation', () => {
  it('discards the chosen card', async () => {
    const game = electedGame();
    await handlePresidentLegislation(game, fakeClient('{"action":{"type":"discard","index":1}}'), noop, noop);
    expect(eventsOf(game, 'president_discard')).toEqual([{ playerId: 'p0', discardIndex: 1, discardedCard: 'liberal', passedCards: deck('F', 'F') }]);
    expect(game.state.drawnCards).toEqual(deck('F', 'F'));
  });

  it.each([
    ['the request fails', new Error('network down')],
    ['the reply is not JSON', 'I discard the liberal one'],
    ['the index is out of range', '{"action":{"type":"discard","index":3}}'],
    ['the index is missing', '{"action":{"type":"discard"}}'],
  ])('when %s, discards the first card, logs a fallback and tells the player', async (_case, reply) => {
    const game = electedGame();
    await handlePresidentLegislation(game, fakeClient(reply), noop, noop);
    expect(eventsOf(game, 'president_discard')).toEqual([{ playerId: 'p0', discardIndex: 0, discardedCard: 'fascist', passedCards: deck('L', 'F'), fallback: true }]);
    expect(game.state.phase).toBe('legislation_chancellor');
    expect(lastMessage(game, 'p0')).toMatch(/\[PRIVATE\].*discarded FASCIST/);
  });

  it('accepts an index given as a numeric string', async () => {
    const game = electedGame();
    await handlePresidentLegislation(game, fakeClient('{"action":{"type":"discard","index":"2"}}'), noop, noop);
    expect(eventsOf(game, 'president_discard')[0]).toMatchObject({ discardIndex: 2 });
  });
});

describe('chancellor legislation', () => {
  // Chancellor holds [LIBERAL, FASCIST]
  async function chancellorHolding() {
    const game = electedGame(deck('F', 'L', 'F', 'L', 'L', 'L'));
    await handlePresidentLegislation(game, fakeClient('{"action":{"type":"discard","index":0}}'), noop, noop);
    return game;
  }

  it('enacts the chosen card', async () => {
    const game = await chancellorHolding();
    await handleChancellorLegislation(game, fakeClient('{"action":{"type":"enact","index":1}}'), noop, noop);
    expect(game.state.fascistPolicies).toBe(1);
    expect(eventsOf(game, 'chancellor_enact')).toEqual([{ playerId: 'p1', enactIndex: 1, enactedPolicy: 'fascist', discardedCard: 'liberal' }]);
  });

  it('an out-of-range index enacts the first card, not a fascist policy', async () => {
    const game = await chancellorHolding();
    await handleChancellorLegislation(game, fakeClient('{"action":{"type":"enact","index":5}}'), noop, noop);
    expect(game.state.liberalPolicies).toBe(1);
    expect(game.state.fascistPolicies).toBe(0);
  });

  it.each([
    ['the request fails', new Error('network down')],
    ['the reply is not JSON', 'Liberal, obviously'],
    ['the index is out of range', '{"action":{"type":"enact","index":5}}'],
  ])('when %s, logs the enactment as a fallback and tells the player', async (_case, reply) => {
    const game = await chancellorHolding();
    await handleChancellorLegislation(game, fakeClient(reply), noop, noop);
    expect(eventsOf(game, 'chancellor_enact')).toEqual([{ playerId: 'p1', enactIndex: 0, enactedPolicy: 'liberal', discardedCard: 'fascist', fallback: true }]);
    expect(eventsOf(game, 'policy_enacted')).toEqual([{ policy: 'liberal', liberalPolicies: 1, fascistPolicies: 0 }]);
    expect(lastMessage(game, 'p1')).toMatch(/\[PRIVATE\].*enacted LIBERAL/);
  });

  it('a veto proposal before 5 fascist policies is ignored and falls back', async () => {
    const game = await chancellorHolding();
    await handleChancellorLegislation(game, fakeClient('{"action":{"type":"veto"}}'), noop, noop);
    expect(game.state.phase).not.toBe('veto_proposed');
    expect(eventsOf(game, 'chancellor_enact')[0]).toMatchObject({ fallback: true });
  });
});

describe('error reporting', () => {
  it('failed requests are reported on the console', async () => {
    await handlePresidentLegislation(electedGame(), fakeClient(new Error('network down')), noop, noop);
    expect(console.error).toHaveBeenCalled();
  });
});
