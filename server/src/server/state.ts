// Game events, state snapshots, and the client-facing view of the game state

import type { GameState, GameEvent, GameHistory } from '../game/types.js';
import type { GameRecord, StateSnapshot } from './gameRecord.js';

// Helper to generate event IDs
let eventCounter = 0;
export function createEvent(
  game: { state: GameState; history: GameHistory },
  type: GameEvent['type'],
  data: Record<string, unknown>
): GameEvent {
  const event: GameEvent = {
    id: `evt-${++eventCounter}`,
    type,
    timestamp: Date.now(),
    round: game.state.round,
    phase: game.state.phase,
    data,
  };
  game.history.events.push(event);
  return event;
}

// Remove secret information from game state for clients
export function sanitizeGameState(state: GameState, extraData?: { legislation?: unknown }): Record<string, unknown> {
  return {
    id: state.id,
    round: state.round,
    phase: state.phase,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      model: p.model,
      role: p.role, // In spectator mode, we show roles
      isAlive: p.isAlive,
    })),
    presidentIndex: state.presidentIndex,
    chancellorIndex: state.chancellorIndex,
    nomineeIndex: state.nomineeIndex,
    liberalPolicies: state.liberalPolicies,
    fascistPolicies: state.fascistPolicies,
    failedElections: state.failedElections,
    votes: Object.fromEntries(state.votes),
    winner: state.winner,
    winCondition: state.winCondition,
    // Include legislation data for spectator view
    drawnCards: state.drawnCards,
    legislation: extraData?.legislation,
  };
}

// Create a state snapshot for step navigation
export function createSnapshot(
  game: GameRecord,
  description: string,
  extraData?: { legislation?: unknown }
) {
  const snapshot: StateSnapshot = {
    index: game.snapshots.length,
    description,
    state: sanitizeGameState(game.state, extraData),
    timestamp: Date.now(),
  };
  game.snapshots.push(snapshot);
  return snapshot;
}
