// Game types for Secret Hitler

export type Role = 'liberal' | 'fascist' | 'hitler';
export type PolicyCard = 'liberal' | 'fascist';
export type Vote = 'ja' | 'nein';

export type GamePhase =
  | 'night'           // Initial phase where Fascists learn each other
  | 'nomination'      // President nominates Chancellor
  | 'voting'          // All players vote
  | 'legislation_president'   // President draws and discards
  | 'legislation_chancellor'  // Chancellor enacts policy
  | 'policy_enacted'          // Brief phase showing result
  | 'executive_action'        // President uses power (if unlocked)
  | 'game_over';

export type ExecutiveAction =
  | 'investigate'     // Look at party membership
  | 'special_election' // Pick next president
  | 'peek'            // Look at top 3 cards
  | 'execution';      // Kill a player

export interface Player {
  id: string;
  name: string;
  model: string;
  role: Role;
  isAlive: boolean;
  wasInvestigated: boolean;
}

export interface GameState {
  id: string;
  players: Player[];

  // Turn tracking
  round: number;
  phase: GamePhase;
  presidentIndex: number;
  chancellorIndex: number | null;
  nomineeIndex: number | null;
  lastPresidentIndex: number | null;
  lastChancellorIndex: number | null;

  // Policy deck
  drawPile: PolicyCard[];
  discardPile: PolicyCard[];

  // Board state
  liberalPolicies: number;
  fascistPolicies: number;
  failedElections: number;

  // Current action state
  votes: Map<string, Vote>;
  drawnCards: PolicyCard[];

  // Game end
  winner: 'liberal' | 'fascist' | null;
  winCondition: string | null;
}

// Executive action power based on player count and fascist policies
export function getExecutiveAction(playerCount: number, fascistPolicies: number): ExecutiveAction | null {
  if (playerCount <= 6) {
    // 5-6 players
    if (fascistPolicies === 3) return 'peek';
    if (fascistPolicies === 4 || fascistPolicies === 5) return 'execution';
  } else if (playerCount <= 8) {
    // 7-8 players
    if (fascistPolicies === 2) return 'investigate';
    if (fascistPolicies === 3) return 'special_election';
    if (fascistPolicies === 4 || fascistPolicies === 5) return 'execution';
  } else {
    // 9-10 players
    if (fascistPolicies === 1 || fascistPolicies === 2) return 'investigate';
    if (fascistPolicies === 3) return 'special_election';
    if (fascistPolicies === 4 || fascistPolicies === 5) return 'execution';
  }
  return null;
}

// Role distribution based on player count
export function getRoleDistribution(playerCount: number): { liberals: number; fascists: number } {
  if (playerCount <= 6) return { liberals: playerCount - 2, fascists: 1 };
  if (playerCount <= 8) return { liberals: playerCount - 3, fascists: 2 };
  return { liberals: playerCount - 4, fascists: 3 };
}

// Game history event types for analysis
export type GameEventType =
  | 'game_start'
  | 'round_start'
  | 'nomination'
  | 'thinking'
  | 'thought'
  | 'dialogue'
  | 'vote'
  | 'vote_result'
  | 'cards_drawn'
  | 'president_discard'
  | 'chancellor_enact'
  | 'policy_enacted'
  | 'investigation'
  | 'execution'
  | 'special_election'
  | 'peek'
  | 'game_over';

export interface GameEvent {
  id: string;
  type: GameEventType;
  timestamp: number;
  round: number;
  phase: GamePhase;
  data: Record<string, unknown>;
}

export interface GameHistory {
  gameId: string;
  startTime: number;
  endTime: number | null;
  players: Player[];
  events: GameEvent[];
  finalState: {
    winner: 'liberal' | 'fascist' | null;
    winCondition: string | null;
    liberalPolicies: number;
    fascistPolicies: number;
  };
}
