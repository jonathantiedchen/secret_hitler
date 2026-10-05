import { create } from 'zustand';
import { toggleGamePause } from '../hooks/useGameSocket';

// Types
export type Role = 'liberal' | 'fascist' | 'hitler';
export type GamePhase =
  | 'nomination'
  | 'voting'
  | 'legislation_president'
  | 'legislation_chancellor'
  | 'veto_proposed'
  | 'policy_enacted'
  | 'executive_action'
  | 'game_over';

export type Vote = 'ja' | 'nein' | null;

export interface GamePlayer {
  id: string;
  name: string;
  model: string;
  modelIcon: string;
  modelColor: string;
  role: Role;
  isAlive: boolean;
  currentVote: Vote;
  currentThought: string;
}

export interface ChatMessage {
  id: string;
  type: 'dialogue' | 'action';
  playerId?: string;
  playerName?: string;
  playerIcon?: string;
  playerColor?: string;
  content: string;
  timestamp: number;
}

export interface LegislationState {
  presidentCards: ('liberal' | 'fascist')[];
  discardedCard: 'liberal' | 'fascist' | null;
  chancellorCards: ('liberal' | 'fascist')[];
}

export interface DebugEntry {
  id: string;
  timestamp: number;
  playerId: string;
  playerName: string;
  model: string;
  phase: string;
  prompt: Array<{ role: string; content: string }>;
  response: string;
}

// Input from setup
export interface SetupPlayer {
  id: string;
  name: string;
  model: string;
}

interface GameState {
  // Game data
  gameId: string;
  round: number;
  phase: GamePhase;

  // Tracks
  liberalPolicies: number;
  fascistPolicies: number;
  failedElections: number;

  // Players
  players: GamePlayer[];
  presidentIndex: number;
  chancellorIndex: number | null;

  // Legislation
  legislation: LegislationState | null;

  // Chat feed
  chatMessages: ChatMessage[];

  // Debug
  debugEntries: DebugEntry[];

  // Game end
  winner: 'liberal' | 'fascist' | null;
  winCondition: string | null;

  // UI state
  pinnedThoughtPlayer: number | null;
  isPaused: boolean;
  cost: number;

  // History navigation
  historyIndex: number | null; // null = live
  totalSnapshots: number;
  historyDescription: string | null;

  // Computed
  getActiveThoughtPlayer: () => number;

  // Actions
  initializeGame: (players: SetupPlayer[]) => void;
  setGameId: (id: string) => void;
  setPhase: (phase: GamePhase) => void;
  setPinnedThoughtPlayer: (index: number | null) => void;
  addChatMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  updatePlayerVote: (playerId: string, vote: Vote) => void;
  updatePlayerThought: (playerId: string, thought: string) => void;
  setLegislation: (legislation: LegislationState | null) => void;
  enactPolicy: (policy: 'liberal' | 'fascist') => void;
  togglePause: () => Promise<void>;
  addCost: (amount: number) => void;
  setCost: (cost: number) => void;
  addDebugEntry: (entry: Omit<DebugEntry, 'id' | 'timestamp'>) => void;
  endGame: (winner: 'liberal' | 'fascist', condition: string) => void;
  setHistoryNav: (index: number | null, total: number, description?: string | null) => void;
  reset: () => void;
}

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

export const useGameStore = create<GameState>()((set, get) => ({
  // Empty initial state - populated by server
  gameId: '',
  round: 1,
  phase: 'nomination',

  liberalPolicies: 0,
  fascistPolicies: 0,
  failedElections: 0,

  players: [],
  presidentIndex: 0,
  chancellorIndex: null,

  legislation: null,

  chatMessages: [],

  debugEntries: [],

  winner: null,
  winCondition: null,

  pinnedThoughtPlayer: null,
  isPaused: false,
  cost: 0,

  historyIndex: null,
  totalSnapshots: 0,
  historyDescription: null,

  // Computed: get active thought player based on phase or pinned
  getActiveThoughtPlayer: () => {
    const state = get();
    if (state.pinnedThoughtPlayer !== null) {
      return state.pinnedThoughtPlayer;
    }

    // Smart follow based on phase
    switch (state.phase) {
      case 'nomination':
        return state.presidentIndex;
      case 'voting':
        // Return first alive player who hasn't voted yet, or president
        const votingPlayer = state.players.findIndex(
          (p) => p.isAlive && p.currentVote === null
        );
        return votingPlayer >= 0 ? votingPlayer : state.presidentIndex;
      case 'legislation_president':
        return state.presidentIndex;
      case 'legislation_chancellor':
        return state.chancellorIndex ?? state.presidentIndex;
      case 'veto_proposed':
      case 'executive_action':
        return state.presidentIndex;
      default:
        return state.presidentIndex;
    }
  },

  // Actions
  setGameId: (id) => set({ gameId: id }),

  setPhase: (phase) => set({ phase }),

  setPinnedThoughtPlayer: (index) => set({ pinnedThoughtPlayer: index }),

  addChatMessage: (message) => {
    const newMessage: ChatMessage = {
      ...message,
      id: `msg-${Date.now()}`,
      timestamp: Date.now(),
    };
    set((state) => ({
      chatMessages: [...state.chatMessages, newMessage],
    }));
  },

  updatePlayerVote: (playerId, vote) => {
    set((state) => ({
      players: state.players.map((p) =>
        p.id === playerId ? { ...p, currentVote: vote } : p
      ),
    }));
  },

  updatePlayerThought: (playerId, thought) => {
    set((state) => ({
      players: state.players.map((p) =>
        p.id === playerId ? { ...p, currentThought: thought } : p
      ),
    }));
  },

  setLegislation: (legislation) => set({ legislation }),

  enactPolicy: (policy) => {
    set((state) => ({
      liberalPolicies: policy === 'liberal' ? state.liberalPolicies + 1 : state.liberalPolicies,
      fascistPolicies: policy === 'fascist' ? state.fascistPolicies + 1 : state.fascistPolicies,
      legislation: null,
    }));
  },

  togglePause: async () => {
    const gameId = get().gameId;
    if (gameId) {
      try {
        await toggleGamePause(gameId);
        // State will be updated via socket 'paused' event
      } catch (e) {
        console.error('Failed to toggle pause:', e);
      }
    }
  },

  addCost: (amount) => set((state) => ({ cost: state.cost + amount })),

  setCost: (cost) => set({ cost }),

  endGame: (winner, condition) => set({ winner, winCondition: condition, phase: 'game_over' }),

  setHistoryNav: (index, total, description = null) => set({
    historyIndex: index,
    totalSnapshots: total,
    historyDescription: description ?? null,
  }),

  addDebugEntry: (entry) => {
    const newEntry: DebugEntry = {
      ...entry,
      id: `debug-${Date.now()}`,
      timestamp: Date.now(),
    };
    set((state) => ({
      debugEntries: [...state.debugEntries, newEntry],
    }));
  },

  initializeGame: (setupPlayers: SetupPlayer[]) => {
    // Assign roles based on player count
    const playerCount = setupPlayers.length;
    let fascistCount: number;
    if (playerCount <= 6) {
      fascistCount = 1;
    } else if (playerCount <= 8) {
      fascistCount = 2;
    } else {
      fascistCount = 3;
    }

    // Create role array and shuffle
    const roles: Role[] = [
      'hitler',
      ...Array(fascistCount).fill('fascist'),
      ...Array(playerCount - fascistCount - 1).fill('liberal'),
    ];

    // Fisher-Yates shuffle
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    // Create game players with roles
    const gamePlayers: GamePlayer[] = setupPlayers.map((p, i) => {
      const config = getModelConfig(p.model);
      return {
        id: p.id,
        name: p.name,
        model: p.model,
        modelIcon: config.icon,
        modelColor: config.color,
        role: roles[i],
        isAlive: true,
        currentVote: null,
        currentThought: '',
      };
    });

    // Random starting president
    const startingPresident = Math.floor(Math.random() * playerCount);

    // Create initial chat message
    const initialMessages: ChatMessage[] = [
      {
        id: 'msg-init',
        type: 'action',
        content: `Game started with ${playerCount} players`,
        timestamp: Date.now(),
      },
      {
        id: 'msg-president',
        type: 'action',
        content: `${gamePlayers[startingPresident].name} is the first President`,
        timestamp: Date.now() + 1,
      },
    ];

    set({
      gameId: `game-${Date.now()}`,
      round: 1,
      phase: 'nomination',
      liberalPolicies: 0,
      fascistPolicies: 0,
      failedElections: 0,
      players: gamePlayers,
      presidentIndex: startingPresident,
      chancellorIndex: null,
      legislation: null,
      chatMessages: initialMessages,
      winner: null,
      winCondition: null,
      pinnedThoughtPlayer: null,
      isPaused: false,
      cost: 0,
    });
  },

  reset: () => set({
    gameId: '',
    round: 1,
    phase: 'nomination',
    liberalPolicies: 0,
    fascistPolicies: 0,
    failedElections: 0,
    players: [],
    presidentIndex: 0,
    chancellorIndex: null,
    legislation: null,
    chatMessages: [],
    winner: null,
    winCondition: null,
    pinnedThoughtPlayer: null,
    isPaused: false,
    cost: 0,
    historyIndex: null,
    totalSnapshots: 0,
    historyDescription: null,
  }),
}));
