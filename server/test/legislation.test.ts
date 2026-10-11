import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGameRecord, type GameRecord } from '../src/server/gameRecord.js';
import { handlePresidentLegislation, handleChancellorLegislation } from '../src/server/phases/legislation.js';
import { DecisionFailedError } from '../src/server/conversation.js';
import { deck, fakeClient, inOrder } from './helpers.js';

const noop = () => {};

// Rejected replies are logged to the console on purpose; keep test output clean
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

// President P0 and Chancellor P1 elected; the deck is drawn in the given order
function electedGame(drawPile = deck('F', 'L', 'F', 'L', 'L', 'L'), fascistPolicies = 0): GameRecord {
  const players = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, model: 'fake' }));
  const game = createGameRecord(`test-${Math.random()}`, players, null, { retryBaseDelayMs: 0 });
  game.state = { ...game.state, phase: 'legislation_president', presidentIndex: 0, chancellorIndex: 1, drawPile, fascistPolicies };
  return game;
}

const eventsOf = (game: GameRecord, type: string) => game.history.events.filter((e) => e.type === type).map((e) => e.data);
const discard = (index: unknown) => JSON.stringify({ action: { type: 'discard', index } });
const enact = (index: unknown) => JSON.stringify({ action: { type: 'enact', index } });

describe('president legislation', () => {
  it('discards the chosen card', async () => {
    const game = electedGame();
    await handlePresidentLegislation(game, fakeClient(discard(1)), noop, noop);
    expect(eventsOf(game, 'president_discard')).toEqual([{ playerId: 'p0', discardIndex: 1, discardedCard: 'liberal', passedCards: deck('F', 'F') }]);
    expect(game.state.drawnCards).toEqual(deck('F', 'F'));
  });

  it('accepts an index given as a numeric string', async () => {
    const game = electedGame();
    await handlePresidentLegislation(game, fakeClient(discard('2')), noop, noop);
    expect(eventsOf(game, 'president_discard')[0]).toMatchObject({ discardIndex: 2 });
  });

  it.each([3, -1, 'first', null])('rejects index %s, explains, and uses the corrected reply', async (bad) => {
    const game = electedGame();
    const client = fakeClient(inOrder(discard(bad), discard(1)));
    await handlePresidentLegislation(game, client, noop, noop);
    expect(client.sent[1]).toMatch(/"index" must be 0, 1 or 2/);
    expect(eventsOf(game, 'president_discard')[0]).toMatchObject({ discardIndex: 1 });
  });

  it('aborts instead of discarding for a president who never gives a valid index', async () => {
    const game = electedGame();
    await expect(handlePresidentLegislation(game, fakeClient(discard(7)), noop, noop)).rejects.toBeInstanceOf(DecisionFailedError);
    expect(eventsOf(game, 'president_discard')).toEqual([]);
  });
});

describe('chancellor legislation', () => {
  // Chancellor holds [LIBERAL, FASCIST]
  async function chancellorHolding(fascistPolicies = 0) {
    const game = electedGame(deck('F', 'L', 'F', 'L', 'L', 'L'), fascistPolicies);
    await handlePresidentLegislation(game, fakeClient(discard(0)), noop, noop);
    return game;
  }

  it('enacts the chosen card', async () => {
    const game = await chancellorHolding();
    await handleChancellorLegislation(game, fakeClient(enact(1)), noop, noop);
    expect(game.state.fascistPolicies).toBe(1);
    expect(eventsOf(game, 'chancellor_enact')).toEqual([{ playerId: 'p1', enactIndex: 1, enactedPolicy: 'fascist', discardedCard: 'liberal' }]);
  });

  it('an out-of-range index is sent back, never enacted as a fascist policy', async () => {
    const game = await chancellorHolding();
    const client = fakeClient(inOrder(enact(5), enact(0)));
    await handleChancellorLegislation(game, client, noop, noop);
    expect(client.sent[1]).toMatch(/"index" must be 0 or 1/);
    expect(game.state.liberalPolicies).toBe(1);
    expect(game.state.fascistPolicies).toBe(0);
  });

  it('a veto before 5 fascist policies is sent back with the reason', async () => {
    const game = await chancellorHolding();
    const client = fakeClient(inOrder('{"action":{"type":"veto"}}', enact(0)));
    await handleChancellorLegislation(game, client, noop, noop);
    expect(client.sent[1]).toMatch(/veto power is not unlocked/);
    expect(game.state.liberalPolicies).toBe(1);
  });

  it('a veto after 5 fascist policies is proposed', async () => {
    const game = await chancellorHolding(5);
    await handleChancellorLegislation(game, fakeClient('{"action":{"type":"veto"},"dialogue":"No."}'), noop, noop);
    expect(game.state.phase).toBe('veto_proposed');
  });

  it('aborts instead of enacting for a chancellor who never gives a valid index', async () => {
    const game = await chancellorHolding();
    await expect(handleChancellorLegislation(game, fakeClient('Liberal, obviously'), noop, noop)).rejects.toBeInstanceOf(DecisionFailedError);
    expect(eventsOf(game, 'chancellor_enact')).toEqual([]);
    expect(game.state.liberalPolicies + game.state.fascistPolicies).toBe(0);
  });
});
