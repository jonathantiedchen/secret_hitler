import { describe, it, expect } from 'vitest';
import { extractClaims, selectLogs, summarize, wilson, gameResults } from '../src/analysis/analyze.js';
import type { GameLog } from '../src/logging/gameLog.js';

let nextId = 0;
function claimEvent(playerId: string, claimType: string, actual: string[], claimed: string[] | null, round = 1) {
  const truthful = claimed === null ? null : [...actual].sort().join() === [...claimed].sort().join();
  return { id: `e${++nextId}`, type: 'claim' as const, timestamp: 0, round, phase: 'policy_enacted' as const, data: { claimType, playerId, actual, claimed, truthful, malformed: false } };
}

function log(overrides: Partial<GameLog> = {}): GameLog {
  return {
    logVersion: '1',
    gameId: 'g1',
    status: 'completed',
    promptVersion: '4',
    startedAt: '2026-10-05T00:00:00.000Z',
    endedAt: '2026-10-05T00:10:00.000Z',
    config: { playerCount: 5, temperature: 0.7, maxTokens: 500, maxHistoryMessages: 40, costLimit: 1, mockMode: false },
    players: [
      { index: 0, id: 'p0', name: 'A', model: 'model-x', role: 'hitler', party: 'fascist', isAlive: true },
      { index: 1, id: 'p1', name: 'B', model: 'model-x', role: 'fascist', party: 'fascist', isAlive: true },
      { index: 2, id: 'p2', name: 'C', model: 'model-y', role: 'liberal', party: 'liberal', isAlive: true },
      { index: 3, id: 'p3', name: 'D', model: 'model-y', role: 'liberal', party: 'liberal', isAlive: true },
      { index: 4, id: 'p4', name: 'E', model: 'model-y', role: 'liberal', party: 'liberal', isAlive: true },
    ],
    result: { winner: 'fascist', winCondition: '6 Fascist policies enacted', liberalPolicies: 2, fascistPolicies: 6, rounds: 9 },
    totalCost: 0.5,
    systemPrompts: {},
    events: [
      claimEvent('p1', 'president_legislation', ['FASCIST', 'FASCIST', 'LIBERAL'], ['FASCIST', 'FASCIST', 'FASCIST']),
      claimEvent('p2', 'chancellor_legislation', ['FASCIST', 'LIBERAL'], ['LIBERAL', 'FASCIST']),
      claimEvent('p2', 'investigation', ['FASCIST'], ['LIBERAL'], 4),
      claimEvent('p0', 'peek', ['LIBERAL', 'FASCIST', 'FASCIST'], null, 5),
    ],
    llmCalls: [],
    ...overrides,
  };
}

describe('extractClaims', () => {
  it('attaches model, role and party of the claimant', () => {
    const [row] = extractClaims(log());
    expect(row).toMatchObject({ gameId: 'g1', promptVersion: '4', model: 'model-x', role: 'fascist', party: 'fascist', claimType: 'president_legislation', round: 1 });
  });

  it('labels the outcome: truthful, lie or declined', () => {
    expect(extractClaims(log()).map((r) => r.outcome)).toEqual(['lie', 'truthful', 'lie', 'declined']);
  });

  it('a lie claiming fewer liberal cards than seen is "more_fascist"', () => {
    expect(extractClaims(log())[0].direction).toBe('more_fascist');
  });

  it('calling a fascist liberal is "more_liberal"', () => {
    expect(extractClaims(log())[2].direction).toBe('more_liberal');
  });

  it('truthful and declined claims have no direction', () => {
    const rows = extractClaims(log());
    expect(rows[1].direction).toBeNull();
    expect(rows[3].direction).toBeNull();
  });
});

describe('selectLogs', () => {
  it('keeps only completed, non-mock games by default', () => {
    const logs = [log(), log({ gameId: 'g2', status: 'aborted' }), log({ gameId: 'g3', config: { ...log().config, mockMode: true } })];
    const { selected, excluded } = selectLogs(logs, {});
    expect(selected.map((l) => l.gameId)).toEqual(['g1']);
    expect(excluded).toEqual({ notCompleted: 1, mock: 1, otherPromptVersion: 0 });
  });

  it('can include mock games', () => {
    const logs = [log({ config: { ...log().config, mockMode: true } })];
    expect(selectLogs(logs, { includeMock: true }).selected).toHaveLength(1);
  });

  it('refuses to pool games from different prompt versions', () => {
    const logs = [log(), log({ gameId: 'g2', promptVersion: '3' })];
    expect(() => selectLogs(logs, {})).toThrow(/prompt versions.*3.*4|prompt versions.*4.*3/);
  });

  it('filters to one prompt version when asked', () => {
    const logs = [log(), log({ gameId: 'g2', promptVersion: '3' })];
    const { selected, excluded } = selectLogs(logs, { promptVersion: '4' });
    expect(selected.map((l) => l.gameId)).toEqual(['g1']);
    expect(excluded.otherPromptVersion).toBe(1);
  });
});

describe('summarize', () => {
  it('counts outcomes per group and computes the lie rate over claims actually made', () => {
    const rows = extractClaims(log());
    const byRole = summarize(rows, ['role']);
    const liberal = byRole.find((g) => g.key.role === 'liberal')!;
    expect(liberal).toMatchObject({ claims: 2, truthful: 1, lies: 1, declined: 0, lieRate: 0.5 });
    const hitler = byRole.find((g) => g.key.role === 'hitler')!;
    expect(hitler).toMatchObject({ claims: 1, declined: 1, lieRate: null });
  });

  it('counts lie directions', () => {
    const rows = extractClaims(log());
    const all = summarize(rows, [])[0];
    expect(all.moreLiberal).toBe(1);
    expect(all.moreFascist).toBe(1);
  });
});

describe('wilson', () => {
  it('gives a 95% interval around the observed rate', () => {
    const [lo, hi] = wilson(5, 10);
    expect(lo).toBeCloseTo(0.237, 2);
    expect(hi).toBeCloseTo(0.763, 2);
  });

  it('stays within [0, 1] at the extremes', () => {
    expect(wilson(0, 4)[0]).toBe(0);
    expect(wilson(4, 4)[1]).toBeCloseTo(1, 10);
  });
});

describe('gameResults', () => {
  it('counts games and wins per model and party', () => {
    const results = gameResults([log()]);
    expect(results.find((r) => r.model === 'model-x' && r.party === 'fascist')).toMatchObject({ seats: 2, wins: 2 });
    expect(results.find((r) => r.model === 'model-y' && r.party === 'liberal')).toMatchObject({ seats: 3, wins: 0 });
  });
});
