// The in-memory record of each running game

import { createGame } from '../game/engine.js';
import type { GameState, GameHistory, PolicyCard } from '../game/types.js';
import type { ChatMessage } from '../ai/openrouter.js';
import { getSystemPrompt, PROMPT_VERSION, DEFAULT_LYING_INSTRUCTION, type LyingInstruction } from '../ai/prompts.js';
import type { LLMCallRecord, AbortReason, BatchInfo } from '../logging/gameLog.js';
import type { TraceEntry } from './trace.js';

// State snapshot for step navigation
export interface StateSnapshot {
  index: number;
  description: string;
  state: Record<string, unknown>;
  timestamp: number;
}

export interface PublicEvent {
  content: string;
  // Player who caused the event and already has it in their own history
  authorId?: string;
}

export interface GameSettings {
  actionDelay: number;
  showThoughts: boolean;
  temperature: number;
  maxTokens: number;
  costLimit: number;
  maxHistoryMessages: number;
  // Wait before retrying a failed request; doubles on each retry
  retryBaseDelayMs: number;
  // What every player is told about lying (the experimental condition)
  lyingInstruction: LyingInstruction;
}

export interface GameRecord {
  state: GameState;
  apiKey: string | null;
  settings: GameSettings;
  isRunning: boolean;
  isPaused: boolean;
  history: GameHistory;
  totalCost: number;
  snapshots: StateSnapshot[];
  viewingIndex: number | null; // null = live, number = viewing history
  // Per-player LLM conversation (system prompt pinned at index 0)
  playerMessages: Map<string, ChatMessage[]>;
  // Append-only log of public events; each player reads it from their own cursor
  publicEvents: PublicEvent[];
  publicEventCursor: Map<string, number>;
  // Every LLM request, for the game log
  llmCalls: LLMCallRecord[];
  // Messages added to each player's conversation since their last logged call
  unloggedMessages: Map<string, ChatMessage[]>;
  // The current legislative session, kept until both players have made their claims
  legislation: {
    presidentId: string;
    presidentCards: PolicyCard[];
    chancellorId: string | null;
    chancellorCards: PolicyCard[] | null;
    liberalPoliciesBefore: number;
  } | null;
  // Set when the game stops early
  abortReason: AbortReason | null;
  // Technical log shown to the user
  trace: TraceEntry[];
  // Set when the game is part of a batch run
  batch: BatchInfo | null;
}

// Store active games
export const games = new Map<string, GameRecord>();

export function createGameRecord(
  gameId: string,
  players: Array<{ id: string; name: string; model: string }>,
  apiKey: string | null | undefined,
  settings: Partial<GameSettings> | undefined,
  options: { seed?: number; batch?: BatchInfo } = {}
): GameRecord {
  const gameState = createGame(gameId, players, options.seed);

  const history: GameHistory = {
    gameId,
    promptVersion: PROMPT_VERSION,
    startTime: Date.now(),
    endTime: null,
    players: gameState.players.map(p => ({ ...p })),
    events: [],
    finalState: {
      winner: null,
      winCondition: null,
      liberalPolicies: 0,
      fascistPolicies: 0,
    },
  };

  const record: GameRecord = {
    state: gameState,
    apiKey: apiKey || null,
    settings: {
      actionDelay: settings?.actionDelay ?? 2,
      showThoughts: settings?.showThoughts ?? true,
      temperature: settings?.temperature ?? 0.7,
      maxTokens: settings?.maxTokens ?? 1500,
      costLimit: settings?.costLimit ?? 1.0,
      maxHistoryMessages: settings?.maxHistoryMessages ?? 40,
      retryBaseDelayMs: settings?.retryBaseDelayMs ?? 1000,
      lyingInstruction: settings?.lyingInstruction ?? DEFAULT_LYING_INSTRUCTION,
    },
    isRunning: false,
    isPaused: false,
    history,
    totalCost: 0,
    snapshots: [],
    viewingIndex: null,
    playerMessages: new Map(
      gameState.players.map((p) => [
        p.id,
        [{ role: 'system', content: getSystemPrompt(p, gameState.players, settings?.lyingInstruction) } as ChatMessage],
      ])
    ),
    publicEvents: [],
    publicEventCursor: new Map(gameState.players.map((p) => [p.id, 0])),
    llmCalls: [],
    unloggedMessages: new Map(gameState.players.map((p) => [p.id, []])),
    legislation: null,
    abortReason: null,
    trace: [],
    batch: options.batch ?? null,
  };
  games.set(gameId, record);
  return record;
}
