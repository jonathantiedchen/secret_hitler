import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGameRecord, type GameRecord } from '../src/server/gameRecord.js';
import type { GameState } from '../src/game/types.js';
import { handleNomination } from '../src/server/phases/nomination.js';
import { handleVoting } from '../src/server/phases/voting.js';
import { handleExecutiveAction } from '../src/server/phases/executive.js';
import { DecisionFailedError } from '../src/server/conversation.js';
import { fakeClient, inOrder } from './helpers.js';

const noop = () => {};

// Rejected replies are logged to the console on purpose; keep test output clean
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

// Player i is named Pi and uses model "mi", so replies can be scripted per player.
// Roles: P0 Hitler, P1 (and P2 with 7+) Fascist, the rest Liberal.
function gameWith(playerCount: number, state: Partial<GameState> = {}): GameRecord {
  const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i}`, name: `P${i}`, model: `m${i}` }));
  const game = createGameRecord(`test-${Math.random()}`, players, null, { retryBaseDelayMs: 0 });
  const fascists = playerCount <= 6 ? 1 : 2;
  game.state = {
    ...game.state,
    players: game.state.players.map((p, i) => ({ ...p, role: i === 0 ? 'hitler' : i <= fascists ? 'fascist' : 'liberal' })),
    presidentIndex: 0,
    ...state,
  };
  return game;
}

const eventsOf = (game: GameRecord, type: string) => game.history.events.filter((e) => e.type === type).map((e) => e.data);
const nominate = (target: string) => `{"thought":"t","action":{"type":"nominate","target":"${target}"},"dialogue":"d"}`;

describe('nomination', () => {
  it('nominates the chosen player', async () => {
    const game = gameWith(5);
    await handleNomination(game, fakeClient(nominate('P2')), noop, noop);
    expect(eventsOf(game, 'nomination')).toEqual([{ presidentId: 'p0', presidentName: 'P0', nomineeId: 'p2', nomineeName: 'P2' }]);
    expect(game.state.phase).toBe('voting');
  });

  it.each([
    ['an unknown name', 'Zed'],
    ['themselves', 'P0'],
  ])('rejects %s, lists the valid candidates, and uses the corrected reply', async (_case, bad) => {
    const game = gameWith(5);
    const client = fakeClient(inOrder(nominate(bad), nominate('P3')));
    await handleNomination(game, client, noop, noop);
    expect(client.sent[1]).toMatch(new RegExp(`"${bad}" cannot be nominated\\. Valid candidates: P1, P2, P3, P4\\.`));
    expect(eventsOf(game, 'nomination')).toEqual([{ presidentId: 'p0', presidentName: 'P0', nomineeId: 'p3', nomineeName: 'P3' }]);
  });

  it('rejects a term-limited candidate', async () => {
    const game = gameWith(7, { lastChancellorIndex: 3 });
    const client = fakeClient(inOrder(nominate('P3'), nominate('P4')));
    await handleNomination(game, client, noop, noop);
    expect(client.sent[1]).toMatch(/"P3" cannot be nominated/);
    expect(eventsOf(game, 'nomination')[0]).toMatchObject({ nomineeId: 'p4' });
  });

  it('only the accepted reply\'s dialogue is spoken', async () => {
    const game = gameWith(5);
    const say = (target: string, words: string) => `{"action":{"type":"nominate","target":"${target}"},"dialogue":"${words}"}`;
    await handleNomination(game, fakeClient(inOrder(say('Zed', 'I pick Zed'), say('P2', 'I pick P2'))), noop, noop);
    expect(eventsOf(game, 'dialogue').map((d) => d.content)).toEqual(['I pick P2']);
  });

  it('aborts instead of nominating for a president who never names a valid candidate', async () => {
    const game = gameWith(5);
    await expect(handleNomination(game, fakeClient(nominate('Zed')), noop, noop)).rejects.toBeInstanceOf(DecisionFailedError);
    expect(eventsOf(game, 'nomination')).toEqual([]);
    expect(game.state.phase).toBe('nomination');
  });
});

describe('voting', () => {
  const vote = (v: unknown) => JSON.stringify({ thought: 't', action: { type: 'vote', vote: v }, dialogue: 'd' });
  const voting = () => gameWith(5, { phase: 'voting', nomineeIndex: 1 });

  it('records every vote and passes on a ja majority', async () => {
    const game = voting();
    await handleVoting(game, fakeClient(vote('ja')), noop, noop);
    expect(eventsOf(game, 'vote')).toHaveLength(5);
    expect(eventsOf(game, 'vote_result')[0]).toMatchObject({ passed: true, jaCount: 5, neinCount: 0 });
  });

  it.each(['JA', 'Ja', 'yes'])('"%s" counts as ja', async (v) => {
    const game = voting();
    await handleVoting(game, fakeClient(vote(v)), noop, noop);
    expect(eventsOf(game, 'vote_result')[0]).toMatchObject({ jaCount: 5 });
    expect(eventsOf(game, 'vote').every((e) => !e.fallback)).toBe(true);
  });

  it.each(['NEIN', 'no'])('"%s" counts as nein', async (v) => {
    const game = voting();
    await handleVoting(game, fakeClient(vote(v)), noop, noop);
    expect(eventsOf(game, 'vote_result')[0]).toMatchObject({ neinCount: 5 });
  });

  it.each([
    ['a missing vote', '{"thought":"t","action":{"type":"vote"}}'],
    ['an unknown vote', vote('maybe')],
  ])('rejects %s and uses the corrected reply, so every player is counted', async (_case, bad) => {
    const game = voting();
    const p3 = inOrder(bad, vote('nein'));
    const client = fakeClient((model) => (model === 'm3' ? p3() : vote('ja')));
    await handleVoting(game, client, noop, noop);
    expect(client.sent.some((m) => /"vote" must be "ja" or "nein"/.test(m))).toBe(true);
    expect(eventsOf(game, 'vote').find((v) => v.playerId === 'p3')).toMatchObject({ vote: 'nein' });
    expect(eventsOf(game, 'vote_result')[0]).toMatchObject({ jaCount: 4, neinCount: 1 });
  });

  it('aborts instead of voting for a player who never gives a valid vote', async () => {
    const game = voting();
    const client = fakeClient((model) => (model === 'm3' ? vote('maybe') : vote('ja')));
    await expect(handleVoting(game, client, noop, noop)).rejects.toMatchObject({ playerId: 'p3', phase: 'voting' });
    expect(eventsOf(game, 'vote_result')).toEqual([]);
  });
});

describe('executive powers', () => {
  const target = (name: string) => `{"thought":"t","action":{"target":"${name}"},"dialogue":"d"}`;
  const claimReply = '{"thought":"t","action":{"type":"claim","party":null},"dialogue":"d"}';
  // 7 players, President P2: 4 fascist policies = execution, 2 = investigate, 3 = special election
  const atPower = (fascistPolicies: number, state: Partial<GameState> = {}) =>
    gameWith(7, { phase: 'executive_action', presidentIndex: 2, fascistPolicies, ...state });

  it('executes the chosen player', async () => {
    const game = atPower(4);
    await handleExecutiveAction(game, fakeClient(target('P5')), noop, noop);
    expect(eventsOf(game, 'execution')).toEqual([{ presidentId: 'p2', targetId: 'p5', targetName: 'P5', targetRole: 'liberal' }]);
  });

  it.each([
    ['an unknown name', 'Zed'],
    ['themselves', 'P2'],
  ])('execution: rejects %s, lists the valid targets, and uses the corrected reply', async (_case, bad) => {
    const game = atPower(4);
    const client = fakeClient(inOrder(target(bad), target('P5')));
    await handleExecutiveAction(game, client, noop, noop);
    expect(client.sent[1]).toMatch(new RegExp(`"${bad}" is not a valid target\\. Valid targets: P0, P1, P3, P4, P5, P6\\.`));
    expect(eventsOf(game, 'execution')[0]).toMatchObject({ targetId: 'p5' });
  });

  it('investigation: rejects an already investigated player, then claims about the corrected target', async () => {
    const game = atPower(2);
    game.state = { ...game.state, players: game.state.players.map((p, i) => (i === 5 ? { ...p, wasInvestigated: true } : p)) };
    const client = fakeClient(inOrder(target('P5'), target('P6'), claimReply));
    await handleExecutiveAction(game, client, noop, noop);
    expect(client.sent[1]).toMatch(/"P5" is not a valid target/);
    expect(eventsOf(game, 'investigation')[0]).toMatchObject({ targetId: 'p6' });
    expect(eventsOf(game, 'claim')).toHaveLength(1);
  });

  it('special election: rejects a dead player', async () => {
    const game = atPower(3);
    game.state = { ...game.state, players: game.state.players.map((p, i) => (i === 4 ? { ...p, isAlive: false } : p)) };
    const client = fakeClient(inOrder(target('P4'), target('P6')));
    await handleExecutiveAction(game, client, noop, noop);
    expect(client.sent[1]).toMatch(/"P4" is not a valid target/);
    expect(eventsOf(game, 'special_election')[0]).toMatchObject({ targetId: 'p6' });
  });

  it('a failed request does not abort the game: it is retried', async () => {
    const game = atPower(4);
    await handleExecutiveAction(game, fakeClient(inOrder(new Error('network down'), target('P5'))), noop, noop);
    expect(eventsOf(game, 'execution')[0]).toMatchObject({ targetId: 'p5' });
  });

  it('aborts instead of using the power for a president who never names a valid target', async () => {
    const game = atPower(4);
    await expect(handleExecutiveAction(game, fakeClient(target('Zed')), noop, noop)).rejects.toBeInstanceOf(DecisionFailedError);
    expect(eventsOf(game, 'execution')).toEqual([]);
    expect(game.state.players.every((p) => p.isAlive)).toBe(true);
  });
});
