import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createGame, nominate, castVote, tallyVotes, resolveVote, drawCards, presidentDiscard, chancellorEnact, executePlayer, investigatePlayer, specialElection, getValidChancellorCandidates, finishPolicyEnacted, peekCards, proposeVeto, respondToVeto, isVetoUnlocked } from './game/engine.js';
import type { GameState, Vote, GameEvent, GameHistory, Player } from './game/types.js';
import { OpenRouterClient, MockLLMClient } from './ai/openrouter.js';
import { getSystemPrompt, buildStateHeader, getNominationPrompt, getVotingPrompt, getPresidentLegislationPrompt, getChancellorLegislationPrompt, getExecutionPrompt, getInvestigationPrompt, getSpecialElectionPrompt, getVetoResponsePrompt } from './ai/prompts.js';
import type { ChatMessage } from './ai/openrouter.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

// State snapshot for step navigation
interface StateSnapshot {
  index: number;
  description: string;
  state: Record<string, unknown>;
  timestamp: number;
}

// Store active games
const games = new Map<string, {
  state: GameState;
  apiKey: string | null;
  settings: {
    actionDelay: number;
    showThoughts: boolean;
    temperature: number;
    maxTokens: number;
    costLimit: number;
    maxHistoryMessages: number;
  };
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
}>();

type GameRecord = typeof games extends Map<string, infer T> ? T : never;

interface PublicEvent {
  content: string;
  // Player who caused the event and already has it in their own history
  authorId?: string;
}

// Helper to generate event IDs
let eventCounter = 0;
function createEvent(
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

// REST API endpoints
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', games: games.size });
});

app.post('/api/games', (req, res) => {
  const { players, apiKey, settings } = req.body;

  if (!players || players.length < 5 || players.length > 10) {
    return res.status(400).json({ error: 'Need 5-10 players' });
  }

  const gameId = `game-${Date.now()}`;
  const gameState = createGame(gameId, players);

  const history: GameHistory = {
    gameId,
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

  games.set(gameId, {
    state: gameState,
    apiKey: apiKey || null,
    settings: {
      actionDelay: settings?.actionDelay ?? 2,
      showThoughts: settings?.showThoughts ?? true,
      temperature: settings?.temperature ?? 0.7,
      maxTokens: settings?.maxTokens ?? 500,
      costLimit: settings?.costLimit ?? 1.0,
      maxHistoryMessages: settings?.maxHistoryMessages ?? 40,
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
        [{ role: 'system', content: getSystemPrompt(p, gameState.players) } as ChatMessage],
      ])
    ),
    publicEvents: [],
    publicEventCursor: new Map(gameState.players.map((p) => [p.id, 0])),
  });

  res.json({ gameId, state: sanitizeGameState(gameState) });
});

app.get('/api/games/:gameId', (req, res) => {
  const game = games.get(req.params.gameId);
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  res.json({ state: sanitizeGameState(game.state) });
});

// Get game history for analysis
app.get('/api/games/:gameId/history', (req, res) => {
  const game = games.get(req.params.gameId);
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  res.json({ history: game.history });
});

app.post('/api/games/:gameId/start', async (req, res) => {
  const game = games.get(req.params.gameId);
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  if (game.isRunning) {
    return res.status(400).json({ error: 'Game already running' });
  }

  game.isRunning = true;
  res.json({ status: 'started' });

  // Start the game loop in background
  runGameLoop(req.params.gameId);
});

app.post('/api/games/:gameId/pause', (req, res) => {
  const game = games.get(req.params.gameId);
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  game.isPaused = !game.isPaused;
  io.to(req.params.gameId).emit('paused', { isPaused: game.isPaused });
  res.json({ isPaused: game.isPaused });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join', (gameId: string) => {
    socket.join(gameId);
    const game = games.get(gameId);
    if (game) {
      socket.emit('state', sanitizeGameState(game.state));
      // Send current navigation state
      socket.emit('history_nav', {
        currentIndex: game.viewingIndex,
        totalSnapshots: game.snapshots.length,
        isLive: game.viewingIndex === null,
      });
    }
  });

  // Step navigation - go to previous step
  socket.on('step_back', (gameId: string) => {
    const game = games.get(gameId);
    if (!game || game.snapshots.length === 0) return;

    // If viewing live, go to last snapshot
    if (game.viewingIndex === null) {
      game.viewingIndex = game.snapshots.length - 1;
    } else if (game.viewingIndex > 0) {
      game.viewingIndex--;
    }

    const snapshot = game.snapshots[game.viewingIndex];
    io.to(gameId).emit('state', snapshot.state);
    io.to(gameId).emit('history_nav', {
      currentIndex: game.viewingIndex,
      totalSnapshots: game.snapshots.length,
      isLive: false,
      description: snapshot.description,
    });
  });

  // Step navigation - go to next step
  socket.on('step_forward', (gameId: string) => {
    const game = games.get(gameId);
    if (!game || game.snapshots.length === 0) return;

    if (game.viewingIndex === null) return; // Already live

    if (game.viewingIndex < game.snapshots.length - 1) {
      game.viewingIndex++;
      const snapshot = game.snapshots[game.viewingIndex];
      io.to(gameId).emit('state', snapshot.state);
      io.to(gameId).emit('history_nav', {
        currentIndex: game.viewingIndex,
        totalSnapshots: game.snapshots.length,
        isLive: false,
        description: snapshot.description,
      });
    } else {
      // Go back to live
      game.viewingIndex = null;
      io.to(gameId).emit('state', sanitizeGameState(game.state));
      io.to(gameId).emit('history_nav', {
        currentIndex: null,
        totalSnapshots: game.snapshots.length,
        isLive: true,
      });
    }
  });

  // Go directly to live state
  socket.on('go_live', (gameId: string) => {
    const game = games.get(gameId);
    if (!game) return;

    game.viewingIndex = null;
    io.to(gameId).emit('state', sanitizeGameState(game.state));
    io.to(gameId).emit('history_nav', {
      currentIndex: null,
      totalSnapshots: game.snapshots.length,
      isLive: true,
    });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Remove secret information from game state for clients
function sanitizeGameState(state: GameState, extraData?: { legislation?: unknown }): Record<string, unknown> {
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
function createSnapshot(
  game: typeof games extends Map<string, infer T> ? T : never,
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

// Append a message to a player's history, trimming oldest non-system messages (FIFO)
function appendToHistory(game: GameRecord, playerId: string, message: ChatMessage) {
  const history = game.playerMessages.get(playerId)!;
  history.push(message);
  const cap = Math.max(2, game.settings.maxHistoryMessages);
  if (history.length > cap) {
    history.splice(1, history.length - cap);
  }
}

// Record a public event that every player will see on their next turn
function publishEvent(game: GameRecord, content: string, authorId?: string) {
  game.publicEvents.push({ content, authorId });
}

// Information only one player learns (cards seen, investigation result, ...)
function tellPrivately(game: GameRecord, playerId: string, content: string) {
  appendToHistory(game, playerId, { role: 'user', content: `[PRIVATE] ${content}` });
}

function formatTracks(state: GameState): string {
  return `(Tracks: Liberal ${state.liberalPolicies}/5, Fascist ${state.fascistPolicies}/6.)`;
}

// Bring a player's history up to date and ask them to act.
// Returns the LLM response; the assistant reply is appended to their history.
async function askPlayer(
  game: GameRecord,
  llmClient: OpenRouterClient | MockLLMClient,
  player: Player,
  actionPrompt: string
) {
  // Deliver public events the player hasn't seen yet
  const cursor = game.publicEventCursor.get(player.id) ?? 0;
  const unseen = game.publicEvents
    .slice(cursor)
    .filter((e) => e.authorId !== player.id)
    .map((e) => `- ${e.content}`);
  game.publicEventCursor.set(player.id, game.publicEvents.length);
  if (unseen.length > 0) {
    appendToHistory(game, player.id, {
      role: 'user',
      content: `PUBLIC EVENTS since your last turn:\n${unseen.join('\n')}`,
    });
  }

  appendToHistory(game, player.id, {
    role: 'user',
    content: buildStateHeader(game.state) + '\n' + actionPrompt,
  });

  const history = game.playerMessages.get(player.id)!;
  const prompt = [...history];
  try {
    const response = await llmClient.chat(player.model, history, {
      temperature: game.settings.temperature,
      maxTokens: game.settings.maxTokens,
    });
    appendToHistory(game, player.id, { role: 'assistant', content: response.content });
    return { response, prompt };
  } catch (error) {
    // Drop the unanswered prompt so the next turn doesn't start with a dangling question
    history.pop();
    throw error;
  }
}

// Main game loop
async function runGameLoop(gameId: string) {
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

  try {
    while (game.state.phase !== 'game_over' && game.isRunning) {
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

    emit('state', sanitizeGameState(game.state));
    emit('game_over', {
      winner: game.state.winner,
      winCondition: game.state.winCondition,
    });
  } catch (error) {
    console.error('Game loop error:', error);
    emit('error', { message: 'Game error occurred' });
    game.isRunning = false;
  }
}

async function handleNomination(
  game: ReturnType<typeof games.get> & {},
  llmClient: OpenRouterClient | MockLLMClient,
  emit: (event: string, data: unknown) => void,
  trackCost: (cost: number) => void
) {
  const president = game.state.players[game.state.presidentIndex];
  const validCandidates = getValidChancellorCandidates(game.state);

  const nominationPrompt = getNominationPrompt(game.state, validCandidates);

  createEvent(game, 'thinking', { playerId: president.id, playerName: president.name });
  emit('thinking', { playerId: president.id, playerName: president.name });

  let response;
  try {
    let prompt: ChatMessage[];
    ({ response, prompt } = await askPlayer(game, llmClient, president, nominationPrompt));

    // Track cost
    trackCost(response.cost);

    // Emit debug info
    emit('debug', {
      playerId: president.id,
      playerName: president.name,
      model: president.model,
      phase: 'nomination',
      prompt,
      response: response.content,
    });
  } catch (apiError) {
    console.error(`API error for ${president.name} (${president.model}):`, apiError);
    // Fallback on API error: pick random valid candidate
    const randomIndex = validCandidates[Math.floor(Math.random() * validCandidates.length)];
    game.state = nominate(game.state, randomIndex);
    publishEvent(game, `President ${president.name} nominated ${game.state.players[randomIndex].name} as Chancellor.`);
    emit('action', {
      type: 'nominate',
      actor: president.name,
      target: game.state.players[randomIndex].name,
    });
    return;
  }

  try {
    const parsed = JSON.parse(response.content);

    // Emit thought
    if (parsed.thought) {
      createEvent(game, 'thought', {
        playerId: president.id,
        playerName: president.name,
        content: parsed.thought,
      });
      if (game.settings.showThoughts) {
        emit('thought', {
          playerId: president.id,
          playerName: president.name,
          content: parsed.thought,
        });
      }
    }

    // Emit dialogue
    if (parsed.dialogue) {
      createEvent(game, 'dialogue', {
        playerId: president.id,
        playerName: president.name,
        content: parsed.dialogue,
      });
      publishEvent(game, `${president.name}: "${parsed.dialogue}"`, president.id);
      emit('dialogue', {
        playerId: president.id,
        playerName: president.name,
        content: parsed.dialogue,
      });
    }

    // Execute action
    if (parsed.action?.type === 'nominate' && parsed.action.target) {
      const targetIndex = game.state.players.findIndex(
        (p) => p.name.toLowerCase() === parsed.action.target.toLowerCase()
      );

      if (targetIndex >= 0 && validCandidates.includes(targetIndex)) {
        game.state = nominate(game.state, targetIndex);
        publishEvent(game, `President ${president.name} nominated ${game.state.players[targetIndex].name} as Chancellor.`);
        createEvent(game, 'nomination', {
          presidentId: president.id,
          presidentName: president.name,
          nomineeId: game.state.players[targetIndex].id,
          nomineeName: game.state.players[targetIndex].name,
        });
        emit('action', {
          type: 'nominate',
          actor: president.name,
          target: game.state.players[targetIndex].name,
        });
      }
    }
  } catch (e) {
    console.error('Failed to parse nomination response:', e);
    // Fallback: pick random valid candidate
    const randomIndex = validCandidates[Math.floor(Math.random() * validCandidates.length)];
    game.state = nominate(game.state, randomIndex);
    publishEvent(game, `President ${president.name} nominated ${game.state.players[randomIndex].name} as Chancellor.`);
    createEvent(game, 'nomination', {
      presidentId: president.id,
      presidentName: president.name,
      nomineeId: game.state.players[randomIndex].id,
      nomineeName: game.state.players[randomIndex].name,
      fallback: true,
    });
    emit('action', {
      type: 'nominate',
      actor: president.name,
      target: game.state.players[randomIndex].name,
    });
  }
}

async function handleVoting(
  game: ReturnType<typeof games.get> & {},
  llmClient: OpenRouterClient | MockLLMClient,
  emit: (event: string, data: unknown) => void,
  trackCost: (cost: number) => void
) {
  const nominee = game.state.players[game.state.nomineeIndex!];
  const alivePlayers = game.state.players.filter((p) => p.isAlive);

  // Votes are simultaneous: hold voters' public remarks until everyone has voted
  const voteDialogue: PublicEvent[] = [];

  // Each alive player votes
  for (const player of alivePlayers) {
    const votingPrompt = getVotingPrompt(game.state, nominee);

    createEvent(game, 'thinking', { playerId: player.id, playerName: player.name });
    emit('thinking', { playerId: player.id, playerName: player.name });

    let response;
    try {
      let prompt: ChatMessage[];
      ({ response, prompt } = await askPlayer(game, llmClient, player, votingPrompt));

      // Track cost
      trackCost(response.cost);

      // Emit debug info
      emit('debug', {
        playerId: player.id,
        playerName: player.name,
        model: player.model,
        phase: 'voting',
        prompt,
        response: response.content,
      });
    } catch (apiError) {
      console.error(`API error for ${player.name} (${player.model}):`, apiError);
      // Fallback on API error: random vote
      const vote: Vote = Math.random() > 0.5 ? 'ja' : 'nein';
      game.state = castVote(game.state, player.id, vote);
      emit('vote', { playerId: player.id, playerName: player.name, vote });
      continue;
    }

    try {
      const parsed = JSON.parse(response.content);

      if (parsed.thought) {
        createEvent(game, 'thought', {
          playerId: player.id,
          playerName: player.name,
          content: parsed.thought,
        });
        if (game.settings.showThoughts) {
          emit('thought', {
            playerId: player.id,
            playerName: player.name,
            content: parsed.thought,
          });
        }
      }

      if (parsed.dialogue) {
        createEvent(game, 'dialogue', {
          playerId: player.id,
          playerName: player.name,
          content: parsed.dialogue,
        });
        voteDialogue.push({ content: `${player.name}: "${parsed.dialogue}"`, authorId: player.id });
        emit('dialogue', {
          playerId: player.id,
          playerName: player.name,
          content: parsed.dialogue,
        });
      }

      if (parsed.action?.vote) {
        const vote: Vote = parsed.action.vote === 'ja' ? 'ja' : 'nein';
        game.state = castVote(game.state, player.id, vote);
        createEvent(game, 'vote', { playerId: player.id, playerName: player.name, vote });
        emit('vote', { playerId: player.id, playerName: player.name, vote });
      }
    } catch (e) {
      // Fallback: random vote
      const vote: Vote = Math.random() > 0.5 ? 'ja' : 'nein';
      game.state = castVote(game.state, player.id, vote);
      createEvent(game, 'vote', { playerId: player.id, playerName: player.name, vote, fallback: true });
      emit('vote', { playerId: player.id, playerName: player.name, vote });
    }
  }

  // Tally votes
  const result = tallyVotes(game.state);
  const chancellorNominee = game.state.players[game.state.nomineeIndex!];

  game.publicEvents.push(...voteDialogue);
  const perPlayerVotes = alivePlayers
    .map((p) => `${p.name} ${(game.state.votes.get(p.id) ?? '?').toString().toUpperCase()}`)
    .join(', ');
  publishEvent(
    game,
    `Vote on ${game.state.players[game.state.presidentIndex].name} / ${chancellorNominee.name}: ${perPlayerVotes}. Result: ${result.passed ? 'PASSED' : 'FAILED'}.`
  );

  createEvent(game, 'vote_result', {
    passed: result.passed,
    jaCount: result.jaCount,
    neinCount: result.neinCount,
    presidentName: game.state.players[game.state.presidentIndex].name,
    nomineeName: chancellorNominee.name,
  });
  emit('vote_result', result);

  // Log Hitler election check
  if (result.passed && chancellorNominee.role === 'hitler') {
    console.log(`⚠️ Hitler (${chancellorNominee.name}) elected as Chancellor! Fascist policies: ${game.state.fascistPolicies}`);
    if (game.state.fascistPolicies >= 3) {
      console.log('🔴 GAME OVER: Hitler elected after 3+ fascist policies!');
    }
  }

  const before = game.state;
  game.state = resolveVote(game.state);

  if (!result.passed) {
    if (game.state.liberalPolicies !== before.liberalPolicies || game.state.fascistPolicies !== before.fascistPolicies) {
      const policy = game.state.liberalPolicies !== before.liberalPolicies ? 'LIBERAL' : 'FASCIST';
      publishEvent(game, `Election failed (tracker 3/3). Chaos: a ${policy} policy was auto-enacted from the top of the deck. ${formatTracks(game.state)}`);
    } else {
      publishEvent(game, `Election failed (tracker ${game.state.failedElections}/3).`);
    }
  }

  // Verify game state after vote resolution
  if (game.state.phase === 'game_over') {
    console.log(`🏁 Game ended: ${game.state.winCondition}`);
  }
}

async function handlePresidentLegislation(
  game: ReturnType<typeof games.get> & {},
  llmClient: OpenRouterClient | MockLLMClient,
  emit: (event: string, data: unknown) => void,
  trackCost: (cost: number) => void
) {
  const president = game.state.players[game.state.presidentIndex];

  // Draw cards
  game.state = drawCards(game.state);
  const cards = game.state.drawnCards;

  createEvent(game, 'cards_drawn', { playerId: president.id, cards: [...cards] });
  emit('cards_drawn', { playerId: president.id, cards });

  // Create snapshot with drawn cards
  const cardSummary = cards.map(c => c === 'liberal' ? 'L' : 'F').join('');
  createSnapshot(game, `Round ${game.state.round}: President drew ${cardSummary}`, {
    legislation: {
      presidentCards: cards,
      discardedCard: null,
      chancellorCards: [],
    },
  });
  emit('history_nav', { currentIndex: null, totalSnapshots: game.snapshots.length, isLive: true });

  const legislationPrompt = getPresidentLegislationPrompt(game.state, cards);

  createEvent(game, 'thinking', { playerId: president.id, playerName: president.name });
  emit('thinking', { playerId: president.id, playerName: president.name });

  let response;
  try {
    let prompt: ChatMessage[];
    ({ response, prompt } = await askPlayer(game, llmClient, president, legislationPrompt));

    // Track cost
    trackCost(response.cost);

    // Emit debug info
    emit('debug', {
      playerId: president.id,
      playerName: president.name,
      model: president.model,
      phase: 'legislation_president',
      prompt,
      response: response.content,
    });
  } catch (apiError) {
    console.error(`API error for ${president.name} (${president.model}):`, apiError);
    // Fallback: discard first card
    tellPrivately(game, president.id, `You drew ${cards.map((c) => c.toUpperCase()).join(', ')} and discarded ${cards[0].toUpperCase()}.`);
    game.state = presidentDiscard(game.state, 0);
    emit('president_discard', { discardIndex: 0 });
    return;
  }

  try {
    const parsed = JSON.parse(response.content);

    if (parsed.thought) {
      createEvent(game, 'thought', {
        playerId: president.id,
        playerName: president.name,
        content: parsed.thought,
      });
      if (game.settings.showThoughts) {
        emit('thought', {
          playerId: president.id,
          playerName: president.name,
          content: parsed.thought,
        });
      }
    }

    // NOTE: No dialogue during legislation - it's done in silence per rules

    const discardIndex = parsed.action?.index ?? 0;
    const discardedCard = cards[discardIndex];
    const passedCards = cards.filter((_, i) => i !== discardIndex);
    const chancellor = game.state.players[game.state.chancellorIndex!];
    game.state = presidentDiscard(game.state, discardIndex);
    createEvent(game, 'president_discard', {
      playerId: president.id,
      discardIndex,
      discardedCard,
      passedCards,
    });
    emit('president_discard', {
      discardIndex,
      discardedCard,
      passedCards,
      presidentName: president.name,
      chancellorName: chancellor.name,
    });

    // Snapshot after discard showing what was passed
    const discardEmoji = discardedCard === 'liberal' ? 'L' : 'F';
    const passedSummary = passedCards.map(c => c === 'liberal' ? 'L' : 'F').join('');
    createSnapshot(game, `Round ${game.state.round}: President discarded ${discardEmoji}, passed ${passedSummary}`, {
      legislation: {
        presidentCards: cards,
        discardedCard: discardedCard,
        chancellorCards: passedCards,
      },
    });
    emit('history_nav', { currentIndex: null, totalSnapshots: game.snapshots.length, isLive: true });
  } catch (e) {
    const discardedCard = cards[0];
    const passedCards = cards.slice(1);
    const chancellor = game.state.players[game.state.chancellorIndex!];
    game.state = presidentDiscard(game.state, 0);
    createEvent(game, 'president_discard', {
      playerId: president.id,
      discardIndex: 0,
      discardedCard,
      passedCards,
      fallback: true,
    });
    emit('president_discard', {
      discardIndex: 0,
      discardedCard,
      passedCards,
      presidentName: president.name,
      chancellorName: chancellor.name,
    });

    // Snapshot for fallback discard
    createSnapshot(game, `Round ${game.state.round}: President discarded (fallback)`, {
      legislation: {
        presidentCards: cards,
        discardedCard: discardedCard,
        chancellorCards: passedCards,
      },
    });
    emit('history_nav', { currentIndex: null, totalSnapshots: game.snapshots.length, isLive: true });
  }
}

async function handleChancellorLegislation(
  game: ReturnType<typeof games.get> & {},
  llmClient: OpenRouterClient | MockLLMClient,
  emit: (event: string, data: unknown) => void,
  trackCost: (cost: number) => void
) {
  const chancellor = game.state.players[game.state.chancellorIndex!];
  const cards = game.state.drawnCards;

  emit('cards_received', { playerId: chancellor.id, cards });

  // Create snapshot with chancellor's received cards (once per session, not again after a refused veto)
  if (!game.state.vetoRefused) {
    const cardSummary = cards.map(c => c === 'liberal' ? 'L' : 'F').join('');
    createSnapshot(game, `Round ${game.state.round}: Chancellor received ${cardSummary}`, {
      legislation: {
        presidentCards: [], // Already discarded
        discardedCard: null,
        chancellorCards: cards,
      },
    });
    emit('history_nav', { currentIndex: null, totalSnapshots: game.snapshots.length, isLive: true });
  }

  const legislationPrompt = getChancellorLegislationPrompt(game.state, cards);

  createEvent(game, 'thinking', { playerId: chancellor.id, playerName: chancellor.name });
  emit('thinking', { playerId: chancellor.id, playerName: chancellor.name });

  const publishEnacted = (policy: string) => {
    publishEvent(game, `Chancellor ${chancellor.name} enacted a ${policy.toUpperCase()} policy. ${formatTracks(game.state)}`);
  };

  let response;
  try {
    let prompt: ChatMessage[];
    ({ response, prompt } = await askPlayer(game, llmClient, chancellor, legislationPrompt));

    // Track cost
    trackCost(response.cost);

    // Emit debug info
    emit('debug', {
      playerId: chancellor.id,
      playerName: chancellor.name,
      model: chancellor.model,
      phase: 'legislation_chancellor',
      prompt,
      response: response.content,
    });
  } catch (apiError) {
    console.error(`API error for ${chancellor.name} (${chancellor.model}):`, apiError);
    // Fallback: enact first card
    const policy = cards[0];
    tellPrivately(game, chancellor.id, `You received ${cards.map((c) => c.toUpperCase()).join(', ')} and enacted ${policy.toUpperCase()}.`);
    game.state = chancellorEnact(game.state, 0);
    publishEnacted(policy);
    emit('policy_enacted', { policy });
    return;
  }

  try {
    const parsed = JSON.parse(response.content);

    if (parsed.thought) {
      createEvent(game, 'thought', {
        playerId: chancellor.id,
        playerName: chancellor.name,
        content: parsed.thought,
      });
      if (game.settings.showThoughts) {
        emit('thought', {
          playerId: chancellor.id,
          playerName: chancellor.name,
          content: parsed.thought,
        });
      }
    }

    // Veto proposal: public request to the President instead of enacting
    if (parsed.action?.type === 'veto' && isVetoUnlocked(game.state) && !game.state.vetoRefused) {
      game.state = proposeVeto(game.state);
      const request = parsed.dialogue || 'I wish to veto this agenda.';
      createEvent(game, 'veto_proposed', { playerId: chancellor.id, playerName: chancellor.name, cards });
      createEvent(game, 'dialogue', { playerId: chancellor.id, playerName: chancellor.name, content: request });
      publishEvent(game, `Chancellor ${chancellor.name} proposed to veto this agenda.`);
      publishEvent(game, `${chancellor.name}: "${request}"`, chancellor.id);
      emit('dialogue', { playerId: chancellor.id, playerName: chancellor.name, content: request });
      emit('veto_proposed', { chancellorName: chancellor.name });
      return;
    }

    // NOTE: No dialogue during legislation - it's done in silence per rules

    const enactIndex = parsed.action?.index ?? 0;
    const policy = cards[enactIndex];
    const discardedCard = cards[1 - enactIndex];
    game.state = chancellorEnact(game.state, enactIndex);
    publishEnacted(policy);
    createEvent(game, 'chancellor_enact', {
      playerId: chancellor.id,
      enactIndex,
      enactedPolicy: policy,
      discardedCard,
    });
    createEvent(game, 'policy_enacted', {
      policy,
      liberalPolicies: game.state.liberalPolicies,
      fascistPolicies: game.state.fascistPolicies,
    });
    emit('policy_enacted', {
      policy,
      discardedCard,
      chancellorName: chancellor.name,
    });
  } catch (e) {
    const policy = cards[0];
    const discardedCard = cards[1];
    game.state = chancellorEnact(game.state, 0);
    publishEnacted(policy);
    createEvent(game, 'chancellor_enact', {
      playerId: chancellor.id,
      enactIndex: 0,
      enactedPolicy: policy,
      discardedCard,
      fallback: true,
    });
    createEvent(game, 'policy_enacted', {
      policy,
      liberalPolicies: game.state.liberalPolicies,
      fascistPolicies: game.state.fascistPolicies,
    });
    emit('policy_enacted', {
      policy,
      discardedCard,
      chancellorName: chancellor.name,
    });
  }
}

async function handleVetoResponse(
  game: ReturnType<typeof games.get> & {},
  llmClient: OpenRouterClient | MockLLMClient,
  emit: (event: string, data: unknown) => void,
  trackCost: (cost: number) => void
) {
  const president = game.state.players[game.state.presidentIndex];
  const cards = game.state.drawnCards;

  createEvent(game, 'thinking', { playerId: president.id, playerName: president.name });
  emit('thinking', { playerId: president.id, playerName: president.name });

  // Default to refusing: the agenda stands unless the President clearly agrees
  let accept = false;
  try {
    const { response, prompt } = await askPlayer(game, llmClient, president, getVetoResponsePrompt(game.state));
    trackCost(response.cost);
    emit('debug', {
      playerId: president.id,
      playerName: president.name,
      model: president.model,
      phase: 'veto_proposed',
      prompt,
      response: response.content,
    });

    const parsed = JSON.parse(response.content);
    accept = parsed.action?.accept === true;

    if (parsed.thought) {
      createEvent(game, 'thought', { playerId: president.id, playerName: president.name, content: parsed.thought });
      if (game.settings.showThoughts) {
        emit('thought', { playerId: president.id, playerName: president.name, content: parsed.thought });
      }
    }
    if (parsed.dialogue) {
      createEvent(game, 'dialogue', { playerId: president.id, playerName: president.name, content: parsed.dialogue });
      publishEvent(game, `${president.name}: "${parsed.dialogue}"`, president.id);
      emit('dialogue', { playerId: president.id, playerName: president.name, content: parsed.dialogue });
    }
  } catch (e) {
    console.error(`Veto response error for ${president.name}:`, e);
  }

  const before = game.state;
  game.state = respondToVeto(game.state, accept);
  createEvent(game, 'veto_response', { playerId: president.id, playerName: president.name, accept, cards });
  emit('veto_response', { presidentName: president.name, accept });

  if (!accept) {
    publishEvent(game, `President ${president.name} refused the veto. The Chancellor must enact a policy.`);
  } else if (game.state.liberalPolicies !== before.liberalPolicies || game.state.fascistPolicies !== before.fascistPolicies) {
    const policy = game.state.liberalPolicies !== before.liberalPolicies ? 'LIBERAL' : 'FASCIST';
    publishEvent(game, `President ${president.name} agreed to the veto. Both policies were discarded (tracker 3/3). Chaos: a ${policy} policy was auto-enacted from the top of the deck. ${formatTracks(game.state)}`);
  } else {
    publishEvent(game, `President ${president.name} agreed to the veto. Both policies were discarded (tracker ${game.state.failedElections}/3).`);
  }
}

async function handleExecutiveAction(
  game: ReturnType<typeof games.get> & {},
  llmClient: OpenRouterClient | MockLLMClient,
  emit: (event: string, data: unknown) => void,
  trackCost: (cost: number) => void
) {
  const president = game.state.players[game.state.presidentIndex];
  const { getExecutiveAction } = await import('./game/types.js');
  const action = getExecutiveAction(game.state.players.length, game.state.fascistPolicies);

  if (!action) {
    game.state = finishPolicyEnacted(game.state);
    return;
  }

  // Peek needs no decision: the president just learns the top 3 cards
  if (action === 'peek') {
    const peeked = peekCards(game.state);
    tellPrivately(game, president.id, `Policy peek: the top 3 cards of the deck are ${peeked.map((c) => c.toUpperCase()).join(', ')}.`);
    publishEvent(game, `President ${president.name} used the policy peek power and looked at the top 3 cards.`);
    createEvent(game, 'peek', { presidentId: president.id, cards: peeked });
    game.state = finishPolicyEnacted(game.state);
    return;
  }

  let prompt: string;
  switch (action) {
    case 'execution':
      prompt = getExecutionPrompt(game.state);
      break;
    case 'investigate':
      prompt = getInvestigationPrompt(game.state);
      break;
    case 'special_election':
      prompt = getSpecialElectionPrompt(game.state);
      break;
    default:
      game.state = finishPolicyEnacted(game.state);
      return;
  }

  createEvent(game, 'thinking', { playerId: president.id, playerName: president.name });
  emit('thinking', { playerId: president.id, playerName: president.name });

  const { response, prompt: messages } = await askPlayer(game, llmClient, president, prompt);

  // Track cost
  trackCost(response.cost);

  // Emit debug info
  emit('debug', {
    playerId: president.id,
    playerName: president.name,
    model: president.model,
    phase: 'executive_action',
    action,
    prompt: messages,
    response: response.content,
  });

  try {
    const parsed = JSON.parse(response.content);

    if (parsed.thought) {
      createEvent(game, 'thought', {
        playerId: president.id,
        playerName: president.name,
        content: parsed.thought,
      });
      if (game.settings.showThoughts) {
        emit('thought', {
          playerId: president.id,
          playerName: president.name,
          content: parsed.thought,
        });
      }
    }

    if (parsed.dialogue) {
      createEvent(game, 'dialogue', {
        playerId: president.id,
        playerName: president.name,
        content: parsed.dialogue,
      });
      publishEvent(game, `${president.name}: "${parsed.dialogue}"`, president.id);
      emit('dialogue', {
        playerId: president.id,
        playerName: president.name,
        content: parsed.dialogue,
      });
    }

    const targetName = parsed.action?.target;
    const targetIndex = game.state.players.findIndex(
      (p) => p.name.toLowerCase() === targetName?.toLowerCase()
    );

    if (targetIndex >= 0) {
      switch (action) {
        case 'execution':
          game.state = executePlayer(game.state, targetIndex);
          createEvent(game, 'execution', {
            presidentId: president.id,
            targetId: game.state.players[targetIndex].id,
            targetName: game.state.players[targetIndex].name,
            targetRole: game.state.players[targetIndex].role,
          });
          publishEvent(game, `President ${president.name} executed ${game.state.players[targetIndex].name}.`);
          emit('execution', { target: game.state.players[targetIndex].name });
          break;
        case 'investigate':
          const result = investigatePlayer(game.state, targetIndex);
          game.state = result.game;
          createEvent(game, 'investigation', {
            presidentId: president.id,
            targetId: game.state.players[targetIndex].id,
            targetName: game.state.players[targetIndex].name,
            revealedParty: result.party,
          });
          publishEvent(game, `President ${president.name} investigated ${game.state.players[targetIndex].name}'s party membership.`);
          tellPrivately(game, president.id, `Investigation result: ${game.state.players[targetIndex].name} is a ${result.party.toUpperCase()}.`);
          emit('investigation', {
            target: game.state.players[targetIndex].name,
            party: result.party,
          });
          break;
        case 'special_election':
          game.state = specialElection(game.state, targetIndex);
          createEvent(game, 'special_election', {
            presidentId: president.id,
            targetId: game.state.players[targetIndex].id,
            targetName: game.state.players[targetIndex].name,
          });
          publishEvent(game, `President ${president.name} called a special election: ${game.state.players[targetIndex].name} is the next President.`);
          emit('special_election', { target: game.state.players[targetIndex].name });
          break;
      }
    }
  } catch (e) {
    console.error('Executive action error:', e);
    game.state = finishPolicyEnacted(game.state);
  }
}

// Start server
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
