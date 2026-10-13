// Runs a game from start to finish, dispatching each phase to its handler

import { fileURLToPath } from 'node:url';
import { finishPolicyEnacted } from '../game/engine.js';
import { OpenRouterClient, MockLLMClient } from '../ai/openrouter.js';
import { buildGameLog, writeGameLog, type GameLogStatus } from '../logging/gameLog.js';
import { games, type GameRecord } from './gameRecord.js';
import { createEvent, createSnapshot, sanitizeGameState } from './state.js';
import { DecisionFailedError, type Emit, type LLMClient } from './conversation.js';
import { trace } from './trace.js';
import { handleNomination } from './phases/nomination.js';
import { handleVoting } from './phases/voting.js';
import { handlePresidentLegislation, handleChancellorLegislation, handleVetoResponse } from './phases/legislation.js';
import { handleLegislationClaims } from './phases/claims.js';
import { handleExecutiveAction } from './phases/executive.js';

// Game logs go to <repo>/logs by default (same depth from src/ and dist/)
const LOG_DIRECTORY = process.env.LOG_DIRECTORY || fileURLToPath(new URL('../../../logs', import.meta.url));

// Write the game log to disk. Failures are reported but never stop the game.
function saveGameLog(game: GameRecord, status: GameLogStatus, dir: string) {
  try {
    return writeGameLog(dir, buildGameLog(game, status));
  } catch (error) {
    console.error(`Failed to write game log for ${game.history.gameId}:`, error);
  }
}

export interface GameLoopOptions {
  // Where the game log is written
  logDirectory?: string;
  // Replaces the client chosen from the API key (tests, fast mock batches)
  llmClient?: LLMClient;
  // Stop the game at the cost limit instead of pausing it (nobody can resume a batch game)
  stopAtCostLimit?: boolean;
}

// Main game loop. Returns the path of the final game log, if it was written.
export async function runGameLoop(gameId: string, emit: Emit, options: GameLoopOptions = {}): Promise<string | undefined> {
  const game = games.get(gameId);
  if (!game) return;

  const logDirectory = options.logDirectory ?? LOG_DIRECTORY;
  const llmClient = options.llmClient ?? (game.apiKey
    ? new OpenRouterClient(game.apiKey)
    : new MockLLMClient(500));

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Track cost and check limit
  const trackCost = (cost: number) => {
    game.totalCost += cost;
    emit('cost', { cost: game.totalCost, limit: game.settings.costLimit });

    const limit = `Cost limit of $${game.settings.costLimit.toFixed(2)} reached ($${game.totalCost.toFixed(4)} spent)`;
    if (game.totalCost < game.settings.costLimit) return;
    if (options.stopAtCostLimit) {
      if (!game.isRunning) return;
      // The game ends after the current phase; that phase's remaining requests still run
      game.isRunning = false;
      game.abortReason = { message: `Cost limit of $${game.settings.costLimit.toFixed(2)} reached` };
      trace(game, emit, 'warn', 'cost_limit', `${limit}; game stops after this phase`);
    } else if (!game.isPaused) {
      game.isPaused = true;
      trace(game, emit, 'warn', 'cost_limit', `${limit}; game paused`);
      emit('paused', { isPaused: true });
      emit('cost_limit_reached', {
        cost: game.totalCost,
        limit: game.settings.costLimit,
        message: `Cost limit of $${game.settings.costLimit.toFixed(2)} reached. Game paused.`
      });
    }
  };

  trace(game, emit, 'info', 'start', game.apiKey ? 'Game started; players are called through OpenRouter' : 'Game started in mock mode (no API key)');

  // Record game start
  createEvent(game, 'game_start', {
    players: game.state.players.map(p => ({ id: p.id, name: p.name, model: p.model, role: p.role })),
    presidentIndex: game.state.presidentIndex,
  });

  // Create initial snapshot
  const president = game.state.players[game.state.presidentIndex];
  createSnapshot(game, `Game Start - Round ${game.state.round}, ${president.name} is President`);
  emit('history_nav', { currentIndex: null, totalSnapshots: game.snapshots.length, isLive: true });

  let loggedRound = game.state.round;

  try {
    while (game.state.phase !== 'game_over' && game.isRunning) {
      // Save progress each round, so an interrupted game still leaves data
      if (game.state.round !== loggedRound) {
        loggedRound = game.state.round;
        saveGameLog(game, 'in_progress', logDirectory);
      }

      // Wait while paused
      if (game.isPaused && game.isRunning) {
        trace(game, emit, 'info', 'pause', 'Game paused; waiting for resume');
        while (game.isPaused && game.isRunning) {
          await delay(500);
        }
        if (game.isRunning) trace(game, emit, 'info', 'resume', 'Game resumed');
      }
      if (!game.isRunning) break;

      emit('state', sanitizeGameState(game.state));
      const { players, presidentIndex, chancellorIndex, nomineeIndex } = game.state;
      const roles = [
        `President ${players[presidentIndex].name}`,
        chancellorIndex !== null && `Chancellor ${players[chancellorIndex].name}`,
        game.state.phase === 'voting' && nomineeIndex !== null && `nominee ${players[nomineeIndex].name}`,
      ].filter(Boolean).join(', ');
      trace(game, emit, 'info', 'phase', `Round ${game.state.round}: ${game.state.phase} (${roles})`);

      switch (game.state.phase) {
        case 'nomination': {
          const pres = game.state.players[game.state.presidentIndex];
          createSnapshot(game, `Round ${game.state.round}: ${pres.name} nominates Chancellor`);
          emit('history_nav', { currentIndex: null, totalSnapshots: game.snapshots.length, isLive: true });
          await handleNomination(game, llmClient, emit, trackCost);
          break;
        }

        case 'voting': {
          const nominee = game.state.nomineeIndex !== null ? game.state.players[game.state.nomineeIndex] : null;
          createSnapshot(game, `Round ${game.state.round}: Voting on ${nominee?.name || 'Chancellor'}`);
          emit('history_nav', { currentIndex: null, totalSnapshots: game.snapshots.length, isLive: true });
          await handleVoting(game, llmClient, emit, trackCost);
          break;
        }

        case 'legislation_president': {
          // Snapshot created inside handler after cards are drawn
          await handlePresidentLegislation(game, llmClient, emit, trackCost);
          break;
        }

        case 'legislation_chancellor': {
          // Snapshot created inside handler after cards are passed
          await handleChancellorLegislation(game, llmClient, emit, trackCost);
          break;
        }

        case 'policy_enacted': {
          const policy = game.state.liberalPolicies > (game.snapshots.length > 0 ?
            (game.snapshots[game.snapshots.length - 1].state as { liberalPolicies?: number })?.liberalPolicies || 0 : 0)
            ? 'Liberal' : 'Fascist';
          createSnapshot(game, `Round ${game.state.round}: ${policy} policy enacted`);
          emit('history_nav', { currentIndex: null, totalSnapshots: game.snapshots.length, isLive: true });
          await delay(game.settings.actionDelay * 1000);
          game.state = finishPolicyEnacted(game.state);
          break;
        }

        case 'veto_proposed':
          await handleVetoResponse(game, llmClient, emit, trackCost);
          break;

        case 'executive_action':
          await handleExecutiveAction(game, llmClient, emit, trackCost);
          break;
      }

      // Legislative session over: if a policy was enacted, the government claims what they saw
      const inSession = ['legislation_president', 'legislation_chancellor', 'veto_proposed'].includes(game.state.phase);
      if (game.legislation && !inSession) {
        if (game.state.phase === 'policy_enacted' || game.state.phase === 'executive_action') {
          await handleLegislationClaims(game, llmClient, emit, trackCost);
        }
        game.legislation = null;
      }

      await delay(game.settings.actionDelay * 500);
    }

    // Game over - finalize history
    game.history.endTime = Date.now();
    game.history.finalState = {
      winner: game.state.winner,
      winCondition: game.state.winCondition,
      liberalPolicies: game.state.liberalPolicies,
      fascistPolicies: game.state.fascistPolicies,
    };
    createEvent(game, 'game_over', {
      winner: game.state.winner,
      winCondition: game.state.winCondition,
      liberalPolicies: game.state.liberalPolicies,
      fascistPolicies: game.state.fascistPolicies,
    });

    if (game.state.phase !== 'game_over') game.abortReason ??= { message: 'Game was stopped before it ended' };
    const logPath = saveGameLog(game, game.state.phase === 'game_over' ? 'completed' : 'aborted', logDirectory);
    if (logPath) console.log(`📝 Game log written to ${logPath}`);

    if (game.state.phase === 'game_over') {
      trace(game, emit, 'info', 'end', `Game over: ${game.state.winner} team wins (${game.state.winCondition})`);
    } else {
      trace(game, emit, 'warn', 'end', 'Game was stopped before it ended');
    }
    emit('state', sanitizeGameState(game.state));
    emit('game_over', {
      winner: game.state.winner,
      winCondition: game.state.winCondition,
    });
    return logPath;
  } catch (error) {
    // No move is ever made up for a player: if they can't decide, the game ends here
    console.error('Game aborted:', error);
    game.history.endTime = Date.now();
    let message: string;
    let detail: string;
    if (error instanceof DecisionFailedError) {
      const player = game.state.players.find((p) => p.id === error.playerId)!;
      game.abortReason = { playerId: player.id, model: player.model, phase: error.phase, reasons: error.reasons };
      message = `Game aborted: ${player.name} (${player.model}) gave no usable response in ${error.phase} after several attempts. Last problem: ${error.reasons.at(-1)}`;
      detail = error.reasons.map((reason, i) => `${i + 1}. ${reason}`).join('\n');
    } else {
      game.abortReason = { message: error instanceof Error ? error.message : String(error) };
      message = `Game aborted after an unexpected error: ${game.abortReason.message}`;
      detail = error instanceof Error && error.stack ? error.stack : String(error);
    }
    trace(game, emit, 'error', 'abort', message, detail);
    emit('error', { message });
    const logPath = saveGameLog(game, 'aborted', logDirectory);
    game.isRunning = false;
    return logPath;
  }
}
