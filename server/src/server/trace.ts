// Step-by-step technical log of a game (requests, replies, retries, pauses, aborts),
// streamed to the client so a stuck game shows what it is waiting on

import type { GameRecord } from './gameRecord.js';
import type { Emit } from './conversation.js';

export type TraceLevel = 'info' | 'warn' | 'error';

export interface TraceEntry {
  seq: number;
  timestamp: number;
  level: TraceLevel;
  // Kind of step: start, phase, request, reply, rejected, accepted, request_failed, pause, resume, cost_limit, abort, end
  step: string;
  message: string;
  // Raw text behind the step (a rejected reply, an API error), shown on demand
  detail?: string;
}

const MAX_DETAIL_LENGTH = 4000;

export function trace(game: GameRecord, emit: Emit, level: TraceLevel, step: string, message: string, detail?: string) {
  const entry: TraceEntry = {
    seq: game.trace.length,
    timestamp: Date.now(),
    level,
    step,
    message,
    ...(detail !== undefined && { detail: detail.slice(0, MAX_DETAIL_LENGTH) }),
  };
  game.trace.push(entry);
  emit('trace', entry);
  // Problems also go to the server log, tagged with the game they belong to
  if (level !== 'info') {
    (level === 'error' ? console.error : console.warn)(`[${game.history.gameId}] ${step}: ${message}`);
  }
}

// The abort message of a game that stopped early, if any
export function abortMessage(game: GameRecord): string | null {
  return game.trace.filter((e) => e.step === 'abort').at(-1)?.message ?? null;
}
