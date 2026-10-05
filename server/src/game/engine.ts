import type {
  GameState,
  Player,
  Role,
  PolicyCard,
  Vote,
  GamePhase,
  ExecutiveAction,
} from './types.js';
import { getRoleDistribution, getExecutiveAction } from './types.js';

export interface GameEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

// Create a shuffled policy deck (6 Liberal, 11 Fascist)
function createPolicyDeck(): PolicyCard[] {
  const deck: PolicyCard[] = [
    ...Array(6).fill('liberal'),
    ...Array(11).fill('fascist'),
  ];
  return shuffle(deck);
}

// Fisher-Yates shuffle
function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Initialize a new game
export function createGame(
  gameId: string,
  playerSetup: Array<{ id: string; name: string; model: string }>
): GameState {
  const playerCount = playerSetup.length;
  const { liberals, fascists } = getRoleDistribution(playerCount);

  // Create role array: 1 Hitler + fascists + liberals
  const roles: Role[] = shuffle([
    'hitler',
    ...Array(fascists).fill('fascist'),
    ...Array(liberals).fill('liberal'),
  ]);

  const players: Player[] = playerSetup.map((p, i) => ({
    id: p.id,
    name: p.name,
    model: p.model,
    role: roles[i],
    isAlive: true,
    wasInvestigated: false,
  }));

  // Random starting president
  const startingPresident = Math.floor(Math.random() * playerCount);

  return {
    id: gameId,
    players,
    round: 1,
    phase: 'nomination',
    presidentIndex: startingPresident,
    chancellorIndex: null,
    nomineeIndex: null,
    lastPresidentIndex: null,
    lastChancellorIndex: null,
    specialElectionReturnIndex: null,
    drawPile: createPolicyDeck(),
    discardPile: [],
    liberalPolicies: 0,
    fascistPolicies: 0,
    failedElections: 0,
    votes: new Map(),
    drawnCards: [],
    winner: null,
    winCondition: null,
  };
}

// Get alive players
export function getAlivePlayers(game: GameState): Player[] {
  return game.players.filter((p) => p.isAlive);
}

// Get valid chancellor candidates
export function getValidChancellorCandidates(game: GameState): number[] {
  const alivePlayers = game.players
    .map((p, i) => ({ player: p, index: i }))
    .filter(({ player }) => player.isAlive);

  const aliveCount = alivePlayers.length;

  return alivePlayers
    .filter(({ index }) => {
      // Can't nominate self
      if (index === game.presidentIndex) return false;
      // Can't nominate last chancellor
      if (index === game.lastChancellorIndex) return false;
      // Can't nominate last president (only if > 5 alive)
      if (aliveCount > 5 && index === game.lastPresidentIndex) return false;
      return true;
    })
    .map(({ index }) => index);
}

// Nominate a chancellor
export function nominate(game: GameState, nomineeIndex: number): GameState {
  const validCandidates = getValidChancellorCandidates(game);
  if (!validCandidates.includes(nomineeIndex)) {
    throw new Error('Invalid chancellor nomination');
  }

  return {
    ...game,
    phase: 'voting',
    nomineeIndex,
    votes: new Map(),
  };
}

// Cast a vote
export function castVote(game: GameState, playerId: string, vote: Vote): GameState {
  if (game.phase !== 'voting') {
    throw new Error('Not in voting phase');
  }

  const player = game.players.find((p) => p.id === playerId);
  if (!player || !player.isAlive) {
    throw new Error('Invalid voter');
  }

  const newVotes = new Map(game.votes);
  newVotes.set(playerId, vote);

  return {
    ...game,
    votes: newVotes,
  };
}

// Check if all votes are in and tally
export function tallyVotes(game: GameState): {
  passed: boolean;
  jaCount: number;
  neinCount: number;
  allVoted: boolean;
} {
  const alivePlayers = getAlivePlayers(game);
  const allVoted = alivePlayers.every((p) => game.votes.has(p.id));

  if (!allVoted) {
    return { passed: false, jaCount: 0, neinCount: 0, allVoted: false };
  }

  let jaCount = 0;
  let neinCount = 0;

  for (const [, vote] of game.votes) {
    if (vote === 'ja') jaCount++;
    else neinCount++;
  }

  const passed = jaCount > neinCount;
  return { passed, jaCount, neinCount, allVoted: true };
}

// Resolve vote and advance game
export function resolveVote(game: GameState): GameState {
  const { passed, jaCount, neinCount } = tallyVotes(game);

  if (passed) {
    // Check Hitler chancellor win condition
    if (game.fascistPolicies >= 3 && game.players[game.nomineeIndex!].role === 'hitler') {
      return {
        ...game,
        phase: 'game_over',
        winner: 'fascist',
        winCondition: 'Hitler was elected Chancellor after 3 Fascist policies',
        chancellorIndex: game.nomineeIndex,
      };
    }

    // Election succeeded - move to legislation
    return {
      ...game,
      phase: 'legislation_president',
      chancellorIndex: game.nomineeIndex,
      lastPresidentIndex: game.presidentIndex,
      lastChancellorIndex: game.nomineeIndex,
      failedElections: 0,
    };
  } else {
    // Election failed
    const newFailedElections = game.failedElections + 1;

    if (newFailedElections >= 3) {
      // Chaos - enact top policy
      return enactChaosPolicy(game);
    }

    // Move to next president
    return advancePresident({
      ...game,
      phase: 'nomination',
      nomineeIndex: null,
      failedElections: newFailedElections,
    });
  }
}

// Enact chaos policy (3 failed elections)
function enactChaosPolicy(game: GameState): GameState {
  let { drawPile, discardPile } = game;

  // Reshuffle if needed
  if (drawPile.length === 0) {
    drawPile = shuffle(discardPile);
    discardPile = [];
  }

  const policy = drawPile[0];
  drawPile = drawPile.slice(1);

  let newGame: GameState = {
    ...game,
    drawPile,
    discardPile,
    failedElections: 0,
    lastPresidentIndex: null,
    lastChancellorIndex: null,
  };

  // A policy enacted by chaos grants no presidential power
  return enactPolicy(newGame, policy, false);
}

// President draws 3 cards
export function drawCards(game: GameState): GameState {
  if (game.phase !== 'legislation_president') {
    throw new Error('Not in president legislation phase');
  }

  let { drawPile, discardPile } = game;

  // Reshuffle if needed
  if (drawPile.length < 3) {
    drawPile = shuffle([...drawPile, ...discardPile]);
    discardPile = [];
  }

  const drawnCards = drawPile.slice(0, 3);
  drawPile = drawPile.slice(3);

  return {
    ...game,
    drawPile,
    discardPile,
    drawnCards,
  };
}

// President discards one card
export function presidentDiscard(game: GameState, discardIndex: number): GameState {
  if (game.phase !== 'legislation_president' || game.drawnCards.length !== 3) {
    throw new Error('Invalid president discard');
  }

  const discardedCard = game.drawnCards[discardIndex];
  const remainingCards = game.drawnCards.filter((_, i) => i !== discardIndex);

  return {
    ...game,
    phase: 'legislation_chancellor',
    drawnCards: remainingCards,
    discardPile: [...game.discardPile, discardedCard],
  };
}

// Chancellor enacts policy
export function chancellorEnact(game: GameState, enactIndex: number): GameState {
  if (game.phase !== 'legislation_chancellor' || game.drawnCards.length !== 2) {
    throw new Error('Invalid chancellor enact');
  }

  const enactedPolicy = game.drawnCards[enactIndex];
  const discardedCard = game.drawnCards[1 - enactIndex];

  const newGame: GameState = {
    ...game,
    drawnCards: [],
    discardPile: [...game.discardPile, discardedCard],
  };

  return enactPolicy(newGame, enactedPolicy);
}

// Enact a policy and check win conditions
function enactPolicy(game: GameState, policy: PolicyCard, grantsPower = true): GameState {
  let newGame: GameState;

  // End of legislative session: reshuffle if fewer than 3 cards remain,
  // so a policy peek sees the cards the next president will actually draw
  if (game.drawPile.length < 3) {
    game = { ...game, drawPile: shuffle([...game.drawPile, ...game.discardPile]), discardPile: [] };
  }

  if (policy === 'liberal') {
    newGame = {
      ...game,
      liberalPolicies: game.liberalPolicies + 1,
      phase: 'policy_enacted',
    };

    // Check liberal win
    if (newGame.liberalPolicies >= 5) {
      return {
        ...newGame,
        phase: 'game_over',
        winner: 'liberal',
        winCondition: '5 Liberal policies enacted',
      };
    }
  } else {
    newGame = {
      ...game,
      fascistPolicies: game.fascistPolicies + 1,
      phase: 'policy_enacted',
    };

    // Check fascist win
    if (newGame.fascistPolicies >= 6) {
      return {
        ...newGame,
        phase: 'game_over',
        winner: 'fascist',
        winCondition: '6 Fascist policies enacted',
      };
    }

    // Check for executive action
    const action = getExecutiveAction(game.players.length, newGame.fascistPolicies);
    if (action && grantsPower) {
      newGame.phase = 'executive_action';
      // Store action type for handling
    }
  }

  return newGame;
}

// Execute a player
export function executePlayer(game: GameState, targetIndex: number): GameState {
  const target = game.players[targetIndex];
  if (!target || !target.isAlive || targetIndex === game.presidentIndex) {
    throw new Error('Invalid execution target');
  }

  const updatedPlayers = game.players.map((p, i) =>
    i === targetIndex ? { ...p, isAlive: false } : p
  );

  // Check if Hitler was killed
  if (target.role === 'hitler') {
    return {
      ...game,
      players: updatedPlayers,
      phase: 'game_over',
      winner: 'liberal',
      winCondition: 'Hitler was executed',
    };
  }

  // Continue game
  return advancePresident({
    ...game,
    players: updatedPlayers,
    phase: 'nomination',
  });
}

// Investigate a player (returns their party, not role)
export function investigatePlayer(game: GameState, targetIndex: number): {
  game: GameState;
  party: 'liberal' | 'fascist';
} {
  const target = game.players[targetIndex];
  if (!target || !target.isAlive || target.wasInvestigated || targetIndex === game.presidentIndex) {
    throw new Error('Invalid investigation target');
  }

  const updatedPlayers = game.players.map((p, i) =>
    i === targetIndex ? { ...p, wasInvestigated: true } : p
  );

  const party = target.role === 'liberal' ? 'liberal' : 'fascist';

  return {
    game: advancePresident({
      ...game,
      players: updatedPlayers,
      phase: 'nomination',
    }),
    party,
  };
}

// Special election - set next president
export function specialElection(game: GameState, nextPresidentIndex: number): GameState {
  if (nextPresidentIndex === game.presidentIndex) {
    throw new Error('Cannot special elect yourself');
  }
  if (!game.players[nextPresidentIndex]?.isAlive) {
    throw new Error('Invalid special election target');
  }

  return {
    ...game,
    presidentIndex: nextPresidentIndex,
    specialElectionReturnIndex: game.presidentIndex,
    phase: 'nomination',
  };
}

// Peek at top 3 cards
export function peekCards(game: GameState): PolicyCard[] {
  // The deck always holds at least 3 cards after a legislative session (see enactPolicy)
  return game.drawPile.slice(0, 3);
}

// Advance to next president in order
function advancePresident(game: GameState): GameState {
  // After a special election, rotation resumes from the president who called it
  let nextPresident = game.specialElectionReturnIndex ?? game.presidentIndex;
  const playerCount = game.players.length;

  do {
    nextPresident = (nextPresident + 1) % playerCount;
  } while (!game.players[nextPresident].isAlive);

  return {
    ...game,
    presidentIndex: nextPresident,
    specialElectionReturnIndex: null,
    nomineeIndex: null,
    chancellorIndex: null,
    round: game.round + 1,
  };
}

// Finish policy enacted phase and move on
export function finishPolicyEnacted(game: GameState): GameState {
  // Simply advance to next president - executive actions are already
  // handled by setting phase to 'executive_action' in enactPolicy()
  return advancePresident({
    ...game,
    phase: 'nomination',
  });
}
