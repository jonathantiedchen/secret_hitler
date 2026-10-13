import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLLMClient } from '../src/ai/openrouter.js';
import type { LLMClient } from '../src/server/conversation.js';
import type { GameLog } from '../src/logging/gameLog.js';
import { expandGames, parseBatchConfig } from '../src/batch/config.js';
import { runBatch, type BatchRunOptions, type GameResult } from '../src/batch/runner.js';
import { createProgress } from '../src/batch/progress.js';
import type { TraceEntry } from '../src/server/trace.js';

const config = (overrides: Record<string, unknown> = {}) => ({
  name: 'pilot',
  seeds: [1, 2],
  matchups: [
    { label: 'same', model: 'mock', players: 5 },
    { label: 'seats', models: ['mock', 'mock', 'mock', 'mock', 'mock', 'mock'] },
  ],
  ...overrides,
});

describe('batch config', () => {
  it('reads matchups, seeds and defaults', () => {
    const parsed = parseBatchConfig(config({ seeds: { from: 10, count: 3 } }));
    expect(parsed.seeds).toEqual([10, 11, 12]);
    expect(parsed.matchups).toEqual([
      { label: 'same', models: Array(5).fill('mock') },
      { label: 'seats', models: Array(6).fill('mock') },
    ]);
    expect(parsed).toMatchObject({ lyingInstructions: ['allowed'], concurrency: 1, maxTotalCost: null, outputDir: null, settings: {} });
  });

  it('reads game settings', () => {
    const settings = { temperature: 0.7, maxTokens: 16000, requestTimeoutSeconds: 180, costLimit: 3, maxHistoryMessages: 40 };
    expect(parseBatchConfig(config({ settings })).settings).toEqual(settings);
  });

  it('plays every lying instruction on every seed and matchup, seed by seed', () => {
    const games = expandGames(parseBatchConfig(config({ seeds: [1], lyingInstructions: ['none', 'forbidden'] })));
    expect(games.map((g) => [g.gameId, g.lyingInstruction])).toEqual([
      ['pilot-same-none-s1', 'none'],
      ['pilot-seats-none-s1', 'none'],
      ['pilot-same-forbidden-s1', 'forbidden'],
      ['pilot-seats-forbidden-s1', 'forbidden'],
    ]);
  });

  it('plays every matchup on every seed, seed by seed', () => {
    const games = expandGames(parseBatchConfig(config()));
    expect(games.map((g) => g.gameId)).toEqual(['pilot-same-allowed-s1', 'pilot-seats-allowed-s1', 'pilot-same-allowed-s2', 'pilot-seats-allowed-s2']);
    expect(games[1].players[5]).toEqual({ id: 'player-5', name: 'Agent Zeta', model: 'mock' });
  });

  it.each([
    [{ concurency: 2 }, /unknown key "concurency"/],
    [{ name: 'my batch' }, /name must be/],
    [{ seeds: [] }, /must not be empty/],
    [{ seeds: [1, 1] }, /must not repeat/],
    [{ seeds: [-1] }, /seeds\[0\]/],
    [{ seeds: { from: 1 } }, /seeds.count/],
    [{ matchups: [{ label: 'openai/gpt', model: 'mock', players: 5 }] }, /label must be/],
    [{ matchups: [{ label: 'a', model: 'mock', players: 5 }, { label: 'a', model: 'mock', players: 5 }] }, /unique/],
    [{ matchups: [{ label: 'a', model: 'mock', players: 4 }] }, /5 to 10 players/],
    [{ matchups: [{ label: 'a', model: 'mock', players: 5, models: ['mock'] }] }, /either "models"/],
    [{ matchups: [{ label: 'a', models: ['mock', 'mock', 'mock', 'mock', 'openai/gpt-4o-mini'] }] }, /cannot be mixed/],
    [{ settings: { temprature: 1 } }, /unknown key "temprature"/],
    [{ settings: { requestTimeoutSeconds: 0 } }, /settings.requestTimeoutSeconds must be a positive number/],
    [{ maxTotalCost: 0 }, /maxTotalCost must be a positive number/],
    [{ lyingInstructions: [] }, /lyingInstructions must be a non-empty list/],
    [{ lyingInstructions: ['sometimes'] }, /lyingInstructions\[0\] must be one of: none, allowed, encouraged, forbidden/],
    [{ lyingInstructions: ['none', 'none'] }, /must not repeat/],
  ])('rejects %j', (overrides, message) => {
    expect(() => parseBatchConfig(config(overrides))).toThrow(message);
  });
});

describe('batch runner', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sh-batch-'));
    for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const logs = (): GameLog[] => readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const run = (overrides: Partial<BatchRunOptions> & { config?: Record<string, unknown> } = {}) => {
    const { config: configOverrides, ...options } = overrides;
    return runBatch(expandGames(parseBatchConfig(config(configOverrides))), {
      batchName: 'pilot', outputDir: dir, apiKey: null, concurrency: 2, settings: { retryBaseDelayMs: 0 }, ...options,
    });
  };
  // Mock players, charged a fixed amount per request
  const costly = (cost: number) => {
    const mock = new MockLLMClient(0);
    return { chat: async (...args: Parameters<MockLLMClient['chat']>) => ({ ...(await mock.chat(...args)), cost }) } as unknown as LLMClient;
  };
  const failing = { chat: async () => { throw new Error('OpenRouter API error: 401 - invalid key'); } } as unknown as LLMClient;

  it('plays each game to the end and logs its seed and batch', async () => {
    const { results, stopReason } = await run();
    expect(stopReason).toBeNull();
    expect(results.map((r) => r.outcome)).toEqual(['completed', 'completed', 'completed', 'completed']);
    const written = logs();
    expect(written).toHaveLength(4);
    expect(written.map((l) => [l.gameId, l.seed, l.batch]).sort()).toEqual([
      ['pilot-same-allowed-s1', 1, { name: 'pilot', matchup: 'same' }],
      ['pilot-same-allowed-s2', 2, { name: 'pilot', matchup: 'same' }],
      ['pilot-seats-allowed-s1', 1, { name: 'pilot', matchup: 'seats' }],
      ['pilot-seats-allowed-s2', 2, { name: 'pilot', matchup: 'seats' }],
    ]);
  });

  it('reports when each game starts and every event it sends', async () => {
    const started: string[] = [];
    const events = new Map<string, string[]>();
    await run({
      config: { seeds: [1] },
      onGameStart: (spec) => started.push(spec.gameId),
      onGameEvent: (spec, event, data) => {
        const name = event === 'trace' ? `trace:${(data as TraceEntry).step}` : event;
        events.set(spec.gameId, [...(events.get(spec.gameId) ?? []), name]);
      },
    });
    expect(started.sort()).toEqual(['pilot-same-allowed-s1', 'pilot-seats-allowed-s1']);
    for (const id of started) {
      const names = events.get(id)!;
      expect(names[0]).toBe('trace:start');
      expect(names).toContain('trace:request');
      expect(names).toContain('dialogue');
      expect(names).toContain('state');
      expect(names.filter((n) => n.startsWith('trace:')).at(-1)).toBe('trace:end');
    }
  });

  it('waits for each reply as long as the settings say, and logs it', async () => {
    const mock = new MockLLMClient(0);
    const timeouts = new Set<number | undefined>();
    const client = { chat: (...args: Parameters<MockLLMClient['chat']>) => { timeouts.add(args[2]?.timeoutMs); return mock.chat(...args); } } as unknown as LLMClient;
    await run({ llmClient: client, settings: { retryBaseDelayMs: 0, requestTimeoutSeconds: 180 }, config: { seeds: [1], matchups: [{ label: 'a', model: 'mock', players: 5 }] } });
    expect([...timeouts]).toEqual([180_000]);
    expect(logs()[0].config.requestTimeoutSeconds).toBe(180);
  });

  it('deals the same cards and roles to every matchup with the same seed and player count', async () => {
    await run({ config: { matchups: [{ label: 'a', model: 'mock', players: 7 }, { label: 'b', model: 'mock', players: 7 }] } });
    const start = (id: string) => {
      const log = logs().find((l) => l.gameId === id)!;
      return { roles: log.players.map((p) => p.role), firstDraw: log.events.find((e) => e.type === 'cards_drawn')?.data.cards, president: log.events[0].data.presidentIndex };
    };
    expect(start('pilot-b-allowed-s1')).toEqual(start('pilot-a-allowed-s1'));
    expect(start('pilot-b-allowed-s2')).toEqual(start('pilot-a-allowed-s2'));
  });

  it('tells the players of each game its lying instruction, and records it in the log', async () => {
    await run({ config: { seeds: [1], matchups: [{ label: 'a', model: 'mock', players: 5 }], lyingInstructions: ['none', 'forbidden'] } });
    const byInstruction = new Map(logs().map((l) => [l.config.lyingInstruction, l]));
    expect([...byInstruction.keys()].sort()).toEqual(['forbidden', 'none']);
    expect(Object.values(byInstruction.get('forbidden')!.systemPrompts).every((p) => p.includes('You must not lie.'))).toBe(true);
    expect(Object.values(byInstruction.get('none')!.systemPrompts).some((p) => /\blie\b|lying/i.test(p))).toBe(false);
  });

  it('skips games already finished when run again', async () => {
    await run();
    const { results } = await run();
    expect(results.map((r) => r.outcome)).toEqual(['skipped', 'skipped', 'skipped', 'skipped']);
    expect(logs()).toHaveLength(4);
  });

  it('stops after 3 games in a row fail on requests, and plays them again on the next run', async () => {
    const failed = await run({ llmClient: failing, concurrency: 1 });
    expect(failed.stopReason).toMatch(/3 games in a row failed/);
    expect(failed.results.map((r) => r.outcome)).toEqual(['aborted', 'aborted', 'aborted', 'not_started']);

    const retried = await run();
    expect(retried.results.map((r) => r.outcome)).toEqual(['completed', 'completed', 'completed', 'completed']);
    // The failed attempts are kept apart, so analysis only sees the finished games
    expect(logs().map((l) => l.status)).toEqual(['completed', 'completed', 'completed', 'completed']);
    expect(readdirSync(join(dir, 'superseded'))).toHaveLength(3);
  });

  it('keeps games aborted for unusable replies, unless asked to retry them', async () => {
    const invalid = { config: { seeds: [1], matchups: [{ label: 'm', model: 'mock-invalid', players: 5 }] } };
    expect((await run(invalid)).results.map((r) => r.outcome)).toEqual(['aborted']);
    expect((await run(invalid)).results.map((r) => r.outcome)).toEqual(['skipped']);

    // As if replies are now read correctly: the model answers usably
    const mock = new MockLLMClient(0);
    const fixed = { chat: (_model: string, ...rest: [Parameters<MockLLMClient['chat']>[1], Parameters<MockLLMClient['chat']>[2]?]) => mock.chat('mock', ...rest) } as unknown as LLMClient;
    const retried = await run({ ...invalid, llmClient: fixed, retryAborted: true });
    expect(retried.results.map((r) => r.outcome)).toEqual(['completed']);
    expect(readdirSync(join(dir, 'superseded'))).toHaveLength(1);
  });

  it('starts no new game once the budget is spent', async () => {
    const { results, stopReason } = await run({ llmClient: costly(0.01), concurrency: 1, maxTotalCost: 0.05, settings: { retryBaseDelayMs: 0, costLimit: 100 } });
    expect(stopReason).toMatch(/budget of \$0.05 spent/);
    expect(results.map((r) => r.outcome)).toEqual(['completed', 'not_started', 'not_started', 'not_started']);
  });

  it('stops a game at its cost limit and logs it as aborted', async () => {
    const { results } = await run({ llmClient: costly(0.01), concurrency: 1, settings: { retryBaseDelayMs: 0, costLimit: 0.05 }, config: { seeds: [1] } });
    expect(results[0].outcome).toBe('aborted');
    expect(results[0].abortReason).toEqual({ message: 'Cost limit of $0.05 reached' });
    expect(logs().find((l) => l.gameId === 'pilot-same-allowed-s1')?.status).toBe('aborted');
  });
});

describe('batch progress', () => {
  const [spec, other] = expandGames(parseBatchConfig(config({ seeds: [1], matchups: [{ label: 'gpt', model: 'openai/gpt-4o-mini', players: 5 }], lyingInstructions: ['none', 'forbidden'] })));
  let clock = 0;
  const setup = (quiet = false) => {
    const lines: string[] = [];
    clock = new Date(2026, 0, 1, 12, 0, 0).getTime();
    const progress = createProgress({ specs: [spec, other], toPlay: 2, quiet, write: (l) => lines.push(l), color: false, now: () => clock });
    return { lines, progress };
  };
  const step = (stepName: string, message: string, level: TraceEntry['level'] = 'info'): TraceEntry => ({ seq: 0, timestamp: clock, level, step: stepName, message });

  it('prints each game start, step, spoken line and result, tagged with its game', () => {
    const { lines, progress } = setup();
    progress.gameStarted(spec);
    progress.gameEvent(spec, 'trace', step('start', 'Game started'));
    progress.gameEvent(spec, 'trace', step('request', 'Asking Alpha (openai/gpt-4o-mini) for nomination; waiting for the reply'));
    progress.gameEvent(spec, 'dialogue', { playerName: 'Alpha', content: 'I nominate Beta.' });
    progress.gameEvent(spec, 'thought', { playerName: 'Alpha', content: 'private' });
    progress.gameEvent(spec, 'trace', step('end', 'Game over'));
    clock += 250_000;
    progress.gameEnded({ spec, outcome: 'completed', cost: 0.0251, durationMs: 250_000, winner: 'liberal', rounds: 8 } as GameResult);
    expect(lines).toEqual([
      '12:00:00  gpt/none/s1       started: 5 players, openai/gpt-4o-mini',
      '12:00:00  gpt/none/s1       Asking Alpha (openai/gpt-4o-mini) for nomination; waiting for the reply',
      '12:00:00  gpt/none/s1       Alpha says: "I nominate Beta."',
      '12:04:10  gpt/none/s1       [1/2] completed  liberal win, 8 rounds  $0.0251  4m10s',
    ]);
  });

  it('shows where each running game is and how long ago its last step was', () => {
    const { lines, progress } = setup(true);
    progress.gameStarted(spec);
    progress.gameStarted(other);
    progress.gameEvent(spec, 'state', { round: 3, phase: 'election' });
    progress.gameEvent(spec, 'cost', { cost: 0.0123, limit: 3 });
    progress.gameEvent(spec, 'trace', step('request', 'Asking Gamma (openai/gpt-4o-mini) for vote; waiting for the reply'));
    clock += 95_000;
    lines.length = 0;
    progress.status();
    expect(lines).toEqual([
      '--- 12:01:35  0/2 games done, 2 running, $0.0123 spent',
      '    gpt/none/s1       round 3, election, $0.0123, running 1m35s; last step 1m35s ago: Asking Gamma (openai/gpt-4o-mini) for vote; waiting for the reply',
      '    gpt/forbidden/s1  starting, $0.0000, running 1m35s',
    ]);
  });

  it('prints only starts and results when quiet, and no status once nothing runs', () => {
    const { lines, progress } = setup(true);
    progress.gameStarted(spec);
    progress.gameEvent(spec, 'trace', step('rejected', 'Alpha\'s reply was rejected', 'warn'));
    progress.gameEvent(spec, 'dialogue', { playerName: 'Alpha', content: 'Hi' });
    progress.gameEnded({ spec, outcome: 'aborted', cost: 0, durationMs: 1000, abortReason: { message: 'Cost limit of $3.00 reached' } } as GameResult);
    progress.status();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('[1/2] ABORTED    Cost limit of $3.00 reached');
  });
});
