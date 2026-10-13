// Plays a list of games without the UI: several at once, within a budget, and resuming where
// an earlier run of the same batch stopped.

import { mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import { MockLLMClient } from '../ai/openrouter.js';
import type { AbortReason, GameLog } from '../logging/gameLog.js';
import type { LLMClient } from '../server/conversation.js';
import { createGameRecord, games, type GameRecord, type GameSettings } from '../server/gameRecord.js';
import { runGameLoop } from '../server/gameLoop.js';
import type { GameSpec } from './config.js';

export type GameOutcome = 'completed' | 'aborted' | 'skipped' | 'not_started';

export interface GameResult {
  spec: GameSpec;
  outcome: GameOutcome;
  // USD spent in this run
  cost: number;
  durationMs: number;
  logPath?: string;
  winner?: 'liberal' | 'fascist' | null;
  rounds?: number;
  abortReason?: AbortReason | null;
}

export interface BatchRunOptions {
  batchName: string;
  outputDir: string;
  // null plays mock models
  apiKey: string | null;
  concurrency: number;
  maxTotalCost?: number | null;
  settings?: Partial<GameSettings>;
  // Replaces the OpenRouter / mock client (tests)
  llmClient?: LLMClient;
  // Checked before each game starts; a reason stops the batch (e.g. Ctrl+C)
  stopRequested?: () => string | null;
  onGameEnd?: (result: GameResult) => void;
}

// Stop the batch when this many games in a row fail on requests or errors (bad key, no credits, outage)
const MAX_CONSECUTIVE_FAILURES = 3;
const SUPERSEDED_DIR = 'superseded';

// A request failure, or an unexpected error: the game says nothing about the models
export function isInfrastructureFailure(reason: AbortReason | null | undefined): boolean {
  if (!reason) return false;
  if ('reasons' in reason) return reason.reasons.at(-1)?.startsWith('request failed') ?? false;
  return !reason.message.startsWith('Cost limit');
}

// Finished games are kept: completed ones, and those a player could not decide in (a result about the model).
// Anything else (requests failed, cost limit, error, crash mid-game) is played again.
function isFinished(log: GameLog): boolean {
  return log.status === 'completed' || (log.status === 'aborted' && !!log.abortReason && 'reasons' in log.abortReason && !isInfrastructureFailure(log.abortReason));
}

function readLogs(dir: string): Array<{ path: string; log: GameLog }> {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.startsWith('game_') && f.endsWith('.json'));
  } catch {
    return [];
  }
  return files.flatMap((file) => {
    try {
      return [{ path: join(dir, file), log: JSON.parse(readFileSync(join(dir, file), 'utf8')) as GameLog }];
    } catch {
      return [];
    }
  });
}

// The finished log of each game already played in this folder, by game id
export function findFinishedGames(outputDir: string): Map<string, { path: string; log: GameLog }> {
  return new Map(readLogs(outputDir).filter(({ log }) => isFinished(log)).map((entry) => [entry.log.gameId, entry]));
}

export async function runBatch(specs: GameSpec[], options: BatchRunOptions): Promise<{ results: GameResult[]; stopReason: string | null }> {
  mkdirSync(options.outputDir, { recursive: true });
  const logs = readLogs(options.outputDir);
  const finished = findFinishedGames(options.outputDir);
  const llmClient = options.llmClient ?? (options.apiKey ? undefined : new MockLLMClient(0));

  const results: GameResult[] = specs.map((spec) => {
    const done = finished.get(spec.gameId);
    return done
      ? { spec, outcome: 'skipped', cost: 0, durationMs: 0, logPath: done.path, winner: done.log.result.winner, rounds: done.log.result.rounds, abortReason: done.log.abortReason }
      : { spec, outcome: 'not_started', cost: 0, durationMs: 0 };
  });
  const todo = specs.map((_, i) => i).filter((i) => results[i].outcome === 'not_started');

  const running = new Set<GameRecord>();
  let finishedCost = 0;
  const spent = () => finishedCost + [...running].reduce((sum, game) => sum + game.totalCost, 0);
  let consecutiveFailures = 0;
  let stopReason: string | null = null;

  async function play(i: number) {
    const { spec } = results[i];
    // Earlier attempts at this game (crashed, or stopped by failed requests): kept, but out of the analysed folder
    const earlier = logs.filter(({ log }) => log.gameId === spec.gameId);
    if (earlier.length > 0) {
      mkdirSync(join(options.outputDir, SUPERSEDED_DIR), { recursive: true });
      for (const { path } of earlier) renameSync(path, join(options.outputDir, SUPERSEDED_DIR, basename(path)));
    }

    const game = createGameRecord(spec.gameId, spec.players, options.apiKey, { ...options.settings, actionDelay: 0 }, {
      seed: spec.seed,
      batch: { name: options.batchName, matchup: spec.matchup },
    });
    game.isRunning = true;
    running.add(game);
    const start = Date.now();
    try {
      const logPath = await runGameLoop(spec.gameId, () => {}, { logDirectory: options.outputDir, llmClient, stopAtCostLimit: true });
      results[i] = {
        spec,
        outcome: game.state.phase === 'game_over' ? 'completed' : 'aborted',
        cost: game.totalCost,
        durationMs: Date.now() - start,
        logPath,
        winner: game.state.winner,
        rounds: game.state.round,
        abortReason: game.abortReason,
      };
    } finally {
      running.delete(game);
      games.delete(spec.gameId);
      finishedCost += game.totalCost;
    }

    if (isInfrastructureFailure(game.abortReason)) {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        stopReason ??= `${consecutiveFailures} games in a row failed on requests or errors`;
      }
    } else {
      consecutiveFailures = 0;
    }
    options.onGameEnd?.(results[i]);
  }

  let next = 0;
  async function worker() {
    while (next < todo.length && !stopReason) {
      const requested = options.stopRequested?.();
      if (requested) {
        stopReason = requested;
      } else if (options.maxTotalCost != null && spent() >= options.maxTotalCost) {
        // Games already running finish; each can still spend up to its own cost limit
        stopReason = `budget of $${options.maxTotalCost.toFixed(2)} spent`;
      } else {
        await play(todo[next++]);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, todo.length) }, worker));

  return { results, stopReason };
}
