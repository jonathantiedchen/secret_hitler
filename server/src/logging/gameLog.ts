// Persist each game as a JSON file for later analysis (see SPECIFICATION.md 7.4)

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState, GameHistory, GameEvent, Role } from '../game/types.js';
import type { ChatMessage, LLMResponse, CostSource } from '../ai/openrouter.js';

// 2: adds seed and batch
export const GAME_LOG_VERSION = '2';

export type GameLogStatus = 'in_progress' | 'completed' | 'aborted';

// Why a game stopped early: a player who gave no usable decision, or another error
export type AbortReason =
  | { playerId: string; model: string; phase: string; reasons: string[] }
  | { message: string };

// One LLM request. Only the messages added to the player's conversation since
// their previous call are stored; with the system prompt and the history cap
// (config.maxHistoryMessages) the full prompt can be reconstructed.
export interface LLMCallRecord {
  playerId: string;
  round: number;
  phase: GameState['phase'];
  timestamp: number;
  newMessages: ChatMessage[];
  promptMessageCount: number;
  response: string | null;
  model: string | null;
  usage: LLMResponse['usage'] | null;
  cost: number;
  costSource?: CostSource;
  latencyMs: number;
  finishReason?: string;
  // The request failed (network, API)
  error?: string;
  // The reply arrived but could not be used; the model was asked again
  rejected?: string;
}

// Set for games run by the batch runner: the batch and the matchup the game belongs to
export interface BatchInfo {
  name: string;
  matchup: string;
}

export interface GameLogInput {
  state: GameState;
  batch?: BatchInfo | null;
  apiKey: string | null;
  settings: {
    actionDelay: number;
    showThoughts: boolean;
    temperature: number;
    maxTokens: number;
    costLimit: number;
    maxHistoryMessages: number;
    retryBaseDelayMs: number;
  };
  history: GameHistory;
  totalCost: number;
  playerMessages: Map<string, ChatMessage[]>;
  llmCalls: LLMCallRecord[];
  abortReason: AbortReason | null;
}

export interface GameLog {
  logVersion: string;
  gameId: string;
  status: GameLogStatus;
  abortReason: AbortReason | null;
  promptVersion: string;
  // Replays the same deal (roles, first President, deck) with createGame
  seed: number;
  batch: BatchInfo | null;
  startedAt: string;
  endedAt: string | null;
  config: {
    playerCount: number;
    temperature: number;
    maxTokens: number;
    maxHistoryMessages: number;
    costLimit: number;
    mockMode: boolean;
  };
  players: Array<{ index: number; id: string; name: string; model: string; role: Role; party: 'liberal' | 'fascist'; isAlive: boolean }>;
  result: {
    winner: GameState['winner'];
    winCondition: string | null;
    liberalPolicies: number;
    fascistPolicies: number;
    rounds: number;
  };
  totalCost: number;
  systemPrompts: Record<string, string>;
  events: GameEvent[];
  llmCalls: LLMCallRecord[];
}

export function buildGameLog(game: GameLogInput, status: GameLogStatus): GameLog {
  const { state, history, settings } = game;

  return {
    logVersion: GAME_LOG_VERSION,
    gameId: history.gameId,
    status,
    abortReason: game.abortReason,
    promptVersion: history.promptVersion,
    seed: state.seed,
    batch: game.batch ?? null,
    startedAt: new Date(history.startTime).toISOString(),
    endedAt: history.endTime ? new Date(history.endTime).toISOString() : null,
    config: {
      playerCount: state.players.length,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      maxHistoryMessages: settings.maxHistoryMessages,
      costLimit: settings.costLimit,
      mockMode: !game.apiKey,
    },
    players: state.players.map((p, index) => ({
      index,
      id: p.id,
      name: p.name,
      model: p.model,
      role: p.role,
      party: p.role === 'liberal' ? 'liberal' : 'fascist',
      isAlive: p.isAlive,
    })),
    result: {
      winner: state.winner,
      winCondition: state.winCondition,
      liberalPolicies: state.liberalPolicies,
      fascistPolicies: state.fascistPolicies,
      rounds: state.round,
    },
    totalCost: game.totalCost,
    systemPrompts: Object.fromEntries(
      [...game.playerMessages].map(([id, messages]) => [id, messages[0]?.content ?? ''])
    ),
    events: history.events,
    llmCalls: game.llmCalls,
  };
}

// Write the log, replacing any earlier write for the same game. Returns the file path.
export function writeGameLog(dir: string, log: GameLog): string {
  mkdirSync(dir, { recursive: true });
  // 2026-10-05T14:30:22.000Z -> 2026-10-05T143022Z (no colons, valid on every OS)
  const stamp = `${log.startedAt.slice(0, 19).replace(/:/g, '')}Z`;
  const path = join(dir, `game_${log.gameId}_${stamp}.json`);

  // Write to a temp file and rename, so a crash mid-write never leaves a truncated log
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(log, null, 2));
  renameSync(tmp, path);
  return path;
}
