// Live progress of a batch in the terminal: a line when a game starts, every step it takes and what
// its players say out loud (the same trace the web UI shows), its result, and on request a status of
// the games still running, so a slow request shows what it is waiting on.

import type { TraceEntry } from '../server/trace.js';
import type { GameSpec } from './config.js';
import { isInfrastructureFailure, type GameResult } from './runner.js';

export interface ProgressOptions {
  // The batch's games (to line up the game labels) and how many of them this run plays
  specs: GameSpec[];
  toPlay: number;
  // Only start, result and status lines: no steps or dialogue
  quiet: boolean;
  write: (line: string) => void;
  color: boolean;
  now?: () => number;
}

interface RunningGame {
  spec: GameSpec;
  startedAt: number;
  round: number | null;
  phase: string | null;
  cost: number;
  lastStep: string | null;
  lastStepAt: number;
}

const MAX_STATUS_STEP_LENGTH = 120;
const RED = 31, GREEN = 32, YELLOW = 33, CYAN = 36, BOLD = 1, DIM = 2;

export const money = (usd: number) => `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
export const duration = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
};

export function describeAbort(result: GameResult): string {
  const reason = result.abortReason;
  if (!reason) return 'stopped';
  if ('reasons' in reason) {
    const player = result.spec.players.find((p) => p.id === reason.playerId);
    const who = `${player?.name ?? reason.playerId} (${reason.model})`;
    return isInfrastructureFailure(reason)
      ? `requests for ${who} in ${reason.phase} failed: ${reason.reasons.at(-1)?.replace(/^request failed: /, '')}`
      : `${who} gave no usable response in ${reason.phase}: ${reason.reasons.at(-1)}`;
  }
  return reason.message;
}

export function createProgress(options: ProgressOptions) {
  const now = options.now ?? Date.now;
  const paint = (code: number, text: string) => (options.color ? `\x1b[${code}m${text}\x1b[0m` : text);
  const label = (spec: GameSpec) => `${spec.matchup}/${spec.lyingInstruction}/s${spec.seed}`;
  const width = Math.max(0, ...options.specs.map((s) => label(s).length));
  const clock = () => new Date(now()).toTimeString().slice(0, 8);
  const line = (spec: GameSpec, text: string) => options.write(`${clock()}  ${paint(DIM, label(spec).padEnd(width))}  ${text}`);

  const running = new Map<string, RunningGame>();
  let ended = 0;
  let endedCost = 0;

  return {
    gameStarted(spec: GameSpec) {
      running.set(spec.gameId, { spec, startedAt: now(), round: null, phase: null, cost: 0, lastStep: null, lastStepAt: now() });
      const models = [...new Set(spec.players.map((p) => p.model))].join(', ');
      line(spec, paint(BOLD, `started: ${spec.players.length} players, ${models}`));
    },

    // An event the game sent (the ones the web UI receives)
    gameEvent(spec: GameSpec, event: string, data: unknown) {
      const game = running.get(spec.gameId);
      if (!game) return;
      if (event === 'state') {
        ({ round: game.round, phase: game.phase } = data as { round: number; phase: string });
      } else if (event === 'cost') {
        game.cost = (data as { cost: number }).cost;
      } else if (event === 'trace') {
        const entry = data as TraceEntry;
        game.lastStep = entry.message;
        game.lastStepAt = entry.timestamp;
        // The start and the result have their own lines
        if (options.quiet || entry.step === 'start' || entry.step === 'end') return;
        line(spec, entry.level === 'error' ? paint(RED, entry.message) : entry.level === 'warn' ? paint(YELLOW, entry.message) : entry.message);
      } else if (event === 'dialogue' && !options.quiet) {
        const { playerName, content } = data as { playerName: string; content: string };
        line(spec, paint(CYAN, `${playerName} says: "${content}"`));
      }
    },

    gameEnded(result: GameResult) {
      running.delete(result.spec.gameId);
      ended++;
      endedCost += result.cost;
      const what = result.outcome === 'completed'
        ? paint(GREEN, `completed  ${result.winner} win, ${result.rounds} rounds`)
        : paint(RED, `ABORTED    ${describeAbort(result)}`);
      line(result.spec, `[${String(ended).padStart(String(options.toPlay).length)}/${options.toPlay}] ${what}  ${money(result.cost)}  ${duration(result.durationMs)}`);
    },

    // Where each running game is, and how long ago its last step happened
    status() {
      if (running.size === 0) return;
      const spent = endedCost + [...running.values()].reduce((sum, g) => sum + g.cost, 0);
      options.write(paint(DIM, `--- ${clock()}  ${ended}/${options.toPlay} games done, ${running.size} running, ${money(spent)} spent`));
      for (const game of running.values()) {
        const at = game.phase ? `round ${game.round}, ${game.phase}` : 'starting';
        const step = game.lastStep
          ? `; last step ${duration(now() - game.lastStepAt)} ago: ${game.lastStep.length > MAX_STATUS_STEP_LENGTH ? `${game.lastStep.slice(0, MAX_STATUS_STEP_LENGTH)}...` : game.lastStep}`
          : '';
        options.write(paint(DIM, `    ${label(game.spec).padEnd(width)}  ${at}, ${money(game.cost)}, running ${duration(now() - game.startedAt)}${step}`));
      }
    },
  };
}
