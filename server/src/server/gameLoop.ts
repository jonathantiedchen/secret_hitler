// Runs a game from start to finish, dispatching each phase to its handler

import { fileURLToPath } from 'node:url';
import type { Server } from 'socket.io';
import { finishPolicyEnacted } from '../game/engine.js';
import { OpenRouterClient, MockLLMClient } from '../ai/openrouter.js';
import { buildGameLog, writeGameLog, type GameLogStatus } from '../logging/gameLog.js';
import { games, type GameRecord } from './gameRecord.js';
import { createEvent, createSnapshot, sanitizeGameState } from './state.js';
import { DecisionFailedError } from './conversation.js';
import { handleNomination } from './phases/nomination.js';
import { handleVoting } from './phases/voting.js';
import { handlePresidentLegislation, handleChancellorLegislation, handleVetoResponse } from './phases/legislation.js';
import { handleLegislationClaims } from './phases/claims.js';
import { handleExecutiveAction } from './phases/executive.js';

// Game logs go to <repo>/logs by default (same depth from src/ and dist/)
const LOG_DIRECTORY = process.env.LOG_DIRECTORY || fileURLToPath(new URL('../../../logs', import.meta.url));

// Write the game log to disk. Failures are reported but never stop the game.
function saveGameLog(game: GameRecord, status: GameLogStatus) {
  try {
    return writeGameLog(LOG_DIRECTORY, buildGameLog(game, status));
  } catch (error) {
    console.error(`Failed to write game log for ${game.history.gameId}:`, error);
  }
}

// Main game loop
export async function runGameLoop(gameId: string, io: Server) {
  const game = games.get(gameId);
  if (!game) return;

  const llmClient = game.apiKey
    ? new OpenRouterClient(game.apiKey)
    : new MockLLMClient(500);

  const emit = (event: string, data: unknown) => {
    io.to(gameId).emit(event, data);
  };

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Track cost and check limit
  const trackCost = (cost: number) => {
    game.totalCost += cost;
    emit('cost', { cost: game.totalCost, limit: game.settings.costLimit });

    // Check if limit reached
    if (game.totalCost >= game.settings.costLimit && !game.isPaused) {
      game.isPaused = true;
      emit('paused', { isPaused: true });
      emit('cost_limit_reached', {
        cost: game.totalCost,
        limit: game.settings.costLimit,
        message: `Cost limit of $${game.settings.costLimit.toFixed(2)} reached. Game paused.`
      });
    }
  };

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
        saveGameLog(game, 'in_progress');
      }

      // Wait while paused
      while (game.isPaused && game.isRunning) {
        await delay(500);
      }
      if (!game.isRunning) break;

      emit('state', sanitizeGameState(game.state));

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

    if (game.state.phase !== 'game_over') game.abortReason = { message: 'Game was stopped before it ended' };
    const logPath = saveGameLog(game, game.state.phase === 'game_over' ? 'completed' : 'aborted');
    if (logPath) console.log(`📝 Game log written to ${logPath}`);

    emit('state', sanitizeGameState(game.state));
    emit('game_over', {
      winner: game.state.winner,
      winCondition: game.state.winCondition,
    });
  } catch (error) {
    // No move is ever made up for a player: if they can't decide, the game ends here
    console.error('Game aborted:', error);
    game.history.endTime = Date.now();
    if (error instanceof DecisionFailedError) {
      const player = game.state.players.find((p) => p.id === error.playerId)!;
      game.abortReason = { playerId: player.id, model: player.model, phase: error.phase, reasons: error.reasons };
      emit('error', { message: `Game aborted: ${player.name} (${player.model}) gave no usable response in ${error.phase} after several attempts. Last problem: ${error.reasons.at(-1)}` });
    } else {
      game.abortReason = { message: error instanceof Error ? error.message : String(error) };
      emit('error', { message: 'Game aborted after an unexpected error' });
    }
    saveGameLog(game, 'aborted');
    game.isRunning = false;
  }
}
