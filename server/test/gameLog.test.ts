import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGameLog, writeGameLog, type GameLogInput } from '../src/logging/gameLog.js';
import { makeGame } from './helpers.js';

function input(overrides: Partial<GameLogInput> = {}): GameLogInput {
  const state = makeGame(5);
  return {
    state,
    apiKey: 'sk-or-secret-key',
    settings: { actionDelay: 0, showThoughts: true, temperature: 0.7, maxTokens: 800, costLimit: 1, maxHistoryMessages: 40 },
    history: {
      gameId: 'game-1',
      systemPromptVersion: '2',
      startTime: Date.UTC(2026, 9, 5, 14, 30, 22),
      endTime: null,
      players: state.players,
      events: [{ id: 'evt-1', type: 'nomination', timestamp: 1, round: 1, phase: 'nomination', data: {} }],
      finalState: { winner: null, winCondition: null, liberalPolicies: 0, fascistPolicies: 0 },
    },
    totalCost: 0.12,
    playerMessages: new Map(state.players.map((p) => [p.id, [{ role: 'system' as const, content: `system prompt for ${p.name}` }]])),
    llmCalls: [
      {
        playerId: 'p0', round: 1, phase: 'nomination', timestamp: 2,
        newMessages: [{ role: 'user', content: 'PHASE: NOMINATION' }],
        promptMessageCount: 2,
        response: '{"thought":"t"}', model: 'mock', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        cost: 0.01, latencyMs: 300,
      },
    ],
    ...overrides,
  };
}

describe('buildGameLog', () => {
  it('never contains the API key', () => {
    expect(JSON.stringify(buildGameLog(input(), 'completed'))).not.toContain('sk-or-secret-key');
  });

  it('records every player\'s secret role and model', () => {
    const log = buildGameLog(input(), 'completed');
    expect(log.players[0]).toMatchObject({ id: 'p0', name: 'P0', model: 'mock', role: 'hitler', party: 'fascist' });
    expect(log.players[4]).toMatchObject({ role: 'liberal', party: 'liberal' });
  });

  it('records the conditions an experiment would vary', () => {
    const log = buildGameLog(input(), 'completed');
    expect(log.systemPromptVersion).toBe('2');
    expect(log.config).toMatchObject({ playerCount: 5, temperature: 0.7, maxTokens: 800, maxHistoryMessages: 40, mockMode: false });
  });

  it('marks games without an API key as mock mode', () => {
    expect(buildGameLog(input({ apiKey: null }), 'completed').config.mockMode).toBe(true);
  });

  it('includes events, LLM calls, system prompts and cost', () => {
    const log = buildGameLog(input(), 'completed');
    expect(log.events).toHaveLength(1);
    expect(log.llmCalls[0]).toMatchObject({ playerId: 'p0', response: '{"thought":"t"}', latencyMs: 300 });
    expect(log.systemPrompts.p3).toBe('system prompt for P3');
    expect(log.totalCost).toBe(0.12);
  });

  it('records status and result', () => {
    const base = input();
    const state = { ...base.state, phase: 'game_over' as const, winner: 'liberal' as const, winCondition: 'Hitler was executed', liberalPolicies: 2 };
    const log = buildGameLog({ ...base, state }, 'completed');
    expect(log.status).toBe('completed');
    expect(log.result).toMatchObject({ winner: 'liberal', winCondition: 'Hitler was executed', liberalPolicies: 2 });
  });
});

describe('writeGameLog', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sh-logs-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes game_{gameId}_{timestamp}.json, creating the directory', () => {
    const logDir = join(dir, 'nested', 'logs');
    const path = writeGameLog(logDir, buildGameLog(input(), 'completed'));
    expect(path).toBe(join(logDir, 'game_game-1_2026-10-05T143022Z.json'));
    expect(JSON.parse(readFileSync(path, 'utf8')).gameId).toBe('game-1');
  });

  it('rewrites the same file as the game progresses', () => {
    writeGameLog(dir, buildGameLog(input(), 'in_progress'));
    const path = writeGameLog(dir, buildGameLog(input(), 'completed'));
    expect(readdirSync(dir)).toEqual(['game_game-1_2026-10-05T143022Z.json']);
    expect(JSON.parse(readFileSync(path, 'utf8')).status).toBe('completed');
  });
});
