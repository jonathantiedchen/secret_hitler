import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useGameStore } from '../stores/gameStore';
import { SERVER_URL } from '../config';

// Model icon/color mapping
const modelConfig: Record<string, { icon: string; color: string }> = {
  'llama': { icon: '🦙', color: '#8b5cf6' },
  'gpt': { icon: '🤖', color: '#10b981' },
  'claude': { icon: '🎭', color: '#ec4899' },
  'mistral': { icon: '🔷', color: '#f97316' },
  'gemini': { icon: '💎', color: '#06b6d4' },
};

const getModelConfig = (modelId: string) => {
  const lower = modelId.toLowerCase();
  if (lower.includes('llama')) return modelConfig['llama'];
  if (lower.includes('gpt') || lower.includes('openai')) return modelConfig['gpt'];
  if (lower.includes('claude') || lower.includes('anthropic')) return modelConfig['claude'];
  if (lower.includes('mistral')) return modelConfig['mistral'];
  if (lower.includes('gemini') || lower.includes('google')) return modelConfig['gemini'];
  return { icon: '🤖', color: '#888888' };
};


// Store socket reference for step navigation
let currentSocket: Socket | null = null;
let currentGameId: string | null = null;

export function useGameSocket(gameId: string | null) {
  const socketRef = useRef<Socket | null>(null);
  const {
    addChatMessage,
    updatePlayerVote,
    updatePlayerThought,
    setLegislation,
    enactPolicy,
    endGame,
    addDebugEntry,
    setCost,
    setHistoryNav,
    addTraceEntries,
    setGameError,
  } = useGameStore();

  // Use a function to get fresh players state to avoid stale closure
  const getPlayers = () => useGameStore.getState().players;

  // Connect to server
  useEffect(() => {
    if (!gameId) return;

    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;
    currentSocket = socket;
    currentGameId = gameId;

    socket.on('connect', () => {
      console.log('Connected to game server');
      socket.emit('join', gameId);
    });

    socket.on('disconnect', (reason) => {
      console.log('Disconnected from game server');
      currentSocket = null;
      currentGameId = null;
      if (reason !== 'io client disconnect') {
        addTraceEntries([{ timestamp: Date.now(), level: 'warn', step: 'connection', message: `Lost connection to the server (${reason}); reconnecting` }]);
      }
    });

    // Game state update
    socket.on('state', (state) => {
      console.log('Game state update:', state);
      const currentPlayers = getPlayers();

      // Build players from server data, preserving client-side UI data if available
      const updatedPlayers = state.players?.map((serverPlayer: {
        id: string;
        name: string;
        model: string;
        role: string;
        isAlive: boolean;
      }) => {
        const clientPlayer = currentPlayers.find(p => p.id === serverPlayer.id);

        // If we have existing client data, merge with server updates
        if (clientPlayer) {
          return {
            ...clientPlayer,
            role: serverPlayer.role,
            isAlive: serverPlayer.isAlive,
          };
        }

        // Otherwise, create new player from server data
        const config = getModelConfig(serverPlayer.model);
        return {
          id: serverPlayer.id,
          name: serverPlayer.name,
          model: serverPlayer.model,
          modelIcon: config.icon,
          modelColor: config.color,
          role: serverPlayer.role,
          isAlive: serverPlayer.isAlive,
          currentVote: null,
          currentThought: '',
        };
      }) || [];

      // Clear votes when entering nomination phase (new round)
      const shouldClearVotes = state.phase === 'nomination';
      const playersWithVotes = shouldClearVotes
        ? updatedPlayers.map((p: typeof updatedPlayers[0]) => ({ ...p, currentVote: null }))
        : updatedPlayers;

      useGameStore.setState({
        gameId: state.id || useGameStore.getState().gameId,
        round: state.round,
        phase: state.phase,
        presidentIndex: state.presidentIndex,
        chancellorIndex: state.chancellorIndex,
        liberalPolicies: state.liberalPolicies,
        fascistPolicies: state.fascistPolicies,
        failedElections: state.failedElections,
        players: playersWithVotes,
        winner: state.winner,
        winCondition: state.winCondition,
        // Update legislation if included in state (from snapshots)
        ...(state.legislation !== undefined && {
          legislation: state.legislation as {
            presidentCards: ('liberal' | 'fascist')[];
            discardedCard: 'liberal' | 'fascist' | null;
            chancellorCards: ('liberal' | 'fascist')[];
          } | null,
        }),
      });
    });

    // AI thinking
    socket.on('thinking', ({ playerId, playerName }) => {
      console.log(`${playerName} is thinking...`);
      updatePlayerThought(playerId, 'Thinking...');
    });

    // AI thought (private reasoning)
    socket.on('thought', ({ playerId, playerName, content }) => {
      console.log(`${playerName} thought:`, content);
      updatePlayerThought(playerId, content);
    });

    // AI dialogue (public speech)
    socket.on('dialogue', ({ playerId, playerName, content }) => {
      console.log(`${playerName} says:`, content);
      const players = getPlayers();
      const player = players.find(p => p.id === playerId);
      addChatMessage({
        type: 'dialogue',
        playerId,
        playerName,
        playerIcon: player?.modelIcon,
        playerColor: player?.modelColor,
        content,
      });
    });

    // Game actions
    socket.on('action', ({ type, actor, target }) => {
      const actionText = target
        ? `${actor} ${type}d ${target}`
        : `${actor} ${type}`;
      addChatMessage({
        type: 'action',
        content: actionText,
      });
    });

    // Vote cast
    socket.on('vote', ({ playerId, playerName, vote }) => {
      console.log(`${playerName} voted ${vote}`);
      updatePlayerVote(playerId, vote);
    });

    // Vote result
    socket.on('vote_result', ({ passed, jaCount, neinCount }) => {
      const resultText = passed
        ? `Vote passed ${jaCount}-${neinCount}`
        : `Vote failed ${jaCount}-${neinCount}`;
      addChatMessage({
        type: 'action',
        content: resultText,
      });
    });

    // Policy enacted
    socket.on('policy_enacted', ({ policy, discardedCard, chancellorName }) => {
      const policyEmoji = policy === 'liberal' ? '🔵' : '🔴';
      const discardEmoji = discardedCard === 'liberal' ? '🔵' : '🔴';
      addChatMessage({
        type: 'action',
        content: `${chancellorName || 'Chancellor'} enacted ${policyEmoji}, discarded ${discardEmoji}`,
      });
      enactPolicy(policy);
    });

    // Cards drawn (spectator view)
    socket.on('cards_drawn', (data: { playerId: string; cards: string[] }) => {
      console.log('President drew:', data.cards);
      const players = getPlayers();
      const player = players.find(p => p.id === data.playerId);
      const cardSummary = data.cards.map(c => c === 'liberal' ? '🔵' : '🔴').join(' ');
      addChatMessage({
        type: 'action',
        content: `${player?.name || 'President'} drew 3 policies: ${cardSummary}`,
      });
      setLegislation({
        presidentCards: data.cards as ('liberal' | 'fascist')[],
        discardedCard: null,
        chancellorCards: [],
      });
    });

    // President discard
    socket.on('president_discard', ({ discardIndex, discardedCard, passedCards, presidentName, chancellorName }) => {
      // Add chat message about the discard
      if (discardedCard && passedCards) {
        const discardEmoji = discardedCard === 'liberal' ? '🔵' : '🔴';
        const passedEmojis = passedCards.map((c: string) => c === 'liberal' ? '🔵' : '🔴').join(' ');
        addChatMessage({
          type: 'action',
          content: `${presidentName || 'President'} discarded ${discardEmoji}, passed ${passedEmojis} to ${chancellorName || 'Chancellor'}`,
        });
      }

      useGameStore.setState((state) => {
        if (!state.legislation) return state;
        const cards = [...state.legislation.presidentCards];
        const discarded = cards.splice(discardIndex, 1)[0];
        return {
          legislation: {
            ...state.legislation,
            discardedCard: discarded,
            chancellorCards: cards,
          },
        };
      });
    });

    // Cards received by chancellor
    socket.on('cards_received', (data: { cards: string[] }) => {
      console.log('Chancellor received:', data.cards);
    });

    // Execution
    socket.on('execution', ({ target }) => {
      addChatMessage({
        type: 'action',
        content: `${target} was executed`,
      });
    });

    // Investigation
    socket.on('investigation', ({ target, party }) => {
      addChatMessage({
        type: 'action',
        content: `President investigated ${target} (${party})`,
      });
    });

    // Veto
    socket.on('veto_proposed', ({ chancellorName }) => {
      addChatMessage({
        type: 'action',
        content: `${chancellorName} proposed a veto`,
      });
    });

    socket.on('veto_response', ({ presidentName, accept }) => {
      addChatMessage({
        type: 'action',
        content: accept
          ? `${presidentName} agreed to the veto: both policies discarded`
          : `${presidentName} refused the veto`,
      });
    });

    // Public claim about privately seen cards or an investigation
    socket.on('claim', ({ content }) => {
      addChatMessage({
        type: 'action',
        content,
      });
    });

    // Special election
    socket.on('special_election', ({ target }) => {
      addChatMessage({
        type: 'action',
        content: `${target} was chosen as next President`,
      });
    });

    // Game over
    socket.on('game_over', ({ winner, winCondition }) => {
      console.log('Game over:', winner, winCondition);
      endGame(winner, winCondition);
    });

    // Pause state
    socket.on('paused', ({ isPaused }) => {
      useGameStore.setState({ isPaused });
    });

    // History navigation state
    socket.on('history_nav', ({ currentIndex, totalSnapshots, description }) => {
      setHistoryNav(currentIndex, totalSnapshots, description);
    });

    // Debug info (prompts and responses)
    socket.on('debug', ({ playerId, playerName, model, phase, prompt, response }) => {
      console.log(`Debug [${playerName}]:`, { phase, prompt, response });
      addDebugEntry({
        playerId,
        playerName,
        model,
        phase,
        prompt,
        response,
      });
    });

    // Cost update
    socket.on('cost', ({ cost }) => {
      setCost(cost);
    });

    // Cost limit reached - show warning
    socket.on('cost_limit_reached', ({ cost, limit, message }) => {
      console.warn('Cost limit reached:', message);
      addChatMessage({
        type: 'action',
        content: `⚠️ Cost limit reached ($${cost.toFixed(2)}/$${limit.toFixed(2)}). Game paused.`,
      });
    });

    // Technical log: live entries, and the full log so far on (re)joining
    socket.on('trace', (entry) => {
      addTraceEntries([entry]);
    });

    socket.on('trace_history', (entries) => {
      addTraceEntries(entries);
    });

    // The game stopped (or is gone from the server)
    socket.on('error', ({ message }) => {
      console.error('Game error:', message);
      if (useGameStore.getState().gameError === message) return;
      setGameError(message);
      addChatMessage({ type: 'action', content: `⛔ ${message}` });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      currentSocket = null;
      currentGameId = null;
    };
  }, [gameId]);

  return socketRef.current;
}

// Step navigation functions
export function stepBack(): void {
  if (currentSocket && currentGameId) {
    currentSocket.emit('step_back', currentGameId);
  }
}

export function stepForward(): void {
  if (currentSocket && currentGameId) {
    currentSocket.emit('step_forward', currentGameId);
  }
}

export function goLive(): void {
  if (currentSocket && currentGameId) {
    currentSocket.emit('go_live', currentGameId);
  }
}

// API functions
export async function createGame(
  players: Array<{ id: string; name: string; model: string }>,
  apiKey: string | null,
  settings: { actionDelay: number; showThoughts: boolean; temperature: number; maxTokens: number; costLimit: number }
): Promise<string> {
  const response = await fetch(`${SERVER_URL}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ players, apiKey, settings }),
  });

  if (!response.ok) {
    throw new Error('Failed to create game');
  }

  const data = await response.json();
  return data.gameId;
}

export async function startGame(gameId: string): Promise<void> {
  const response = await fetch(`${SERVER_URL}/api/games/${gameId}/start`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to start game');
  }
}

export async function toggleGamePause(gameId: string): Promise<boolean> {
  const response = await fetch(`${SERVER_URL}/api/games/${gameId}/pause`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to toggle pause');
  }

  const data = await response.json();
  return data.isPaused;
}
