import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGameRecord, type GameRecord } from '../src/server/gameRecord.js';
import type { GameState } from '../src/game/types.js';
import { handleNomination } from '../src/server/phases/nomination.js';
import { handleVoting } from '../src/server/phases/voting.js';
import { handleExecutiveAction } from '../src/server/phases/executive.js';
import { fakeClient } from './helpers.js';

const noop = () => {};

// Failed requests are logged to the console on purpose; keep test output clean
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

// Player i is named Pi and uses model "mi", so replies can be scripted per player.
// Roles: P0 Hitler, P1 (and P2 with 7+) Fascist, the rest Liberal.
function gameWith(playerCount: number, state: Partial<GameState> = {}): GameRecord {
  const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i}`, name: `P${i}`, model: `m${i}` }));
  const game = createGameRecord(`test-${Math.random()}`, players, null, {});
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
const lastMessage = (game: GameRecord, playerId: string) => game.playerMessages.get(playerId)!.at(-1)!.content;
const nominate = (target: string) => `{"thought":"t","action":{"type":"nominate","target":"${target}"},"dialogue":"d"}`;

describe('nomination', () => {
  it('nominates the chosen player', async () => {
    const game = gameWith(5);
    await handleNomination(game, fakeClient(nominate('P2')), noop, noop);
    expect(eventsOf(game, 'nomination')).toEqual([{ presidentId: 'p0', presidentName: 'P0', nomineeId: 'p2', nomineeName: 'P2' }]);
    expect(game.state.phase).toBe('voting');
  });

  it.each([
    ['the request fails', new Error('network down')],
    ['the reply is not JSON', 'I pick P2'],
    ['the name is unknown', nominate('Zed')],
    ['the president names themselves', nominate('P0')],
  ])('when %s, nominates a random valid candidate once, flagged as fallback', async (_case, reply) => {
    const game = gameWith(5);
    const client = fakeClient(reply);
    await handleNomination(game, client, noop, noop);
    expect(client.calls).toBe(1);
    const [nomination] = eventsOf(game, 'nomination');
    expect(nomination).toMatchObject({ presidentId: 'p0', fallback: true });
    expect(['p1', 'p2', 'p3', 'p4']).toContain(nomination.nomineeId);
    expect(game.state.phase).toBe('voting');
    expect(lastMessage(game, 'p0')).toMatch(/\[PRIVATE\].*nominated/);
  });

  it('a term-limited target falls back to an eligible candidate', async () => {
    const game = gameWith(7, { lastChancellorIndex: 3 });
    await handleNomination(game, fakeClient(nominate('P3')), noop, noop);
    const [nomination] = eventsOf(game, 'nomination');
    expect(nomination.fallback).toBe(true);
    expect(nomination.nomineeId).not.toBe('p3');
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
    ['the request fails', new Error('network down')],
    ['the reply is not JSON', 'ja'],
    ['the vote is missing', '{"thought":"t","action":{"type":"vote"}}'],
    ['the vote is not ja or nein', vote('maybe')],
  ])('when %s for one player, they get a flagged random vote and everyone is counted', async (_case, reply) => {
    const game = voting();
    await handleVoting(game, fakeClient((model) => (model === 'm3' ? reply : vote('ja'))), noop, noop);
    const votes = eventsOf(game, 'vote');
    expect(votes).toHaveLength(5);
    expect(votes.find((v) => v.playerId === 'p3')).toMatchObject({ fallback: true });
    const [result] = eventsOf(game, 'vote_result');
    expect(Number(result.jaCount) + Number(result.neinCount)).toBe(5);
    expect(result.passed).toBe(true); // 4 ja already make a majority, whatever the random vote
    expect(lastMessage(game, 'p3')).toMatch(/\[PRIVATE\].*vote/i);
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
    ['the request fails', new Error('network down')],
    ['the reply is not JSON', 'P5'],
    ['the name is unknown', target('Zed')],
    ['the president targets themselves', target('P2')],
  ])('execution: when %s, a random valid player is executed once, flagged as fallback', async (_case, reply) => {
    const game = atPower(4);
    const client = fakeClient(reply);
    await handleExecutiveAction(game, client, noop, noop);
    expect(client.calls).toBe(1);
    const [execution] = eventsOf(game, 'execution');
    expect(execution).toMatchObject({ presidentId: 'p2', fallback: true });
    expect(execution.targetId).not.toBe('p2');
    expect(game.state.phase).not.toBe('executive_action');
    expect(lastMessage(game, 'p2')).toMatch(/\[PRIVATE\].*executed/);
  });

  it('investigation: an already investigated target falls back to a new one, and the claim still happens', async () => {
    const base = atPower(2);
    const game = base;
    game.state = { ...game.state, players: game.state.players.map((p, i) => (i === 5 ? { ...p, wasInvestigated: true } : p)) };
    let call = 0;
    await handleExecutiveAction(game, fakeClient(() => (++call === 1 ? target('P5') : claimReply)), noop, noop);
    const [investigation] = eventsOf(game, 'investigation');
    expect(investigation).toMatchObject({ presidentId: 'p2', fallback: true });
    expect(['p5', 'p2']).not.toContain(investigation.targetId);
    expect(eventsOf(game, 'claim')).toHaveLength(1);
  });

  it('special election: a dead target falls back to a living player', async () => {
    const game = atPower(3);
    game.state = { ...game.state, players: game.state.players.map((p, i) => (i === 4 ? { ...p, isAlive: false } : p)) };
    await handleExecutiveAction(game, fakeClient(target('P4')), noop, noop);
    const [election] = eventsOf(game, 'special_election');
    expect(election).toMatchObject({ presidentId: 'p2', fallback: true });
    expect(['p2', 'p4']).not.toContain(election.targetId);
    expect(game.state.phase).toBe('nomination');
  });
});
