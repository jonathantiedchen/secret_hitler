import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Player {
  id: string;
  name: string;
  model: string;
}

export interface GameSettings {
  speedMode: 'realtime' | 'fast';
  actionDelay: number;
  showThoughts: boolean;
  revealRoles: boolean;
  showVoteHistory: boolean;
  maxRetries: number;
  temperature: number;
  maxTokens: number;
  costLimit: number; // Maximum cost in dollars before auto-pause
}

export interface Model {
  id: string;
  name: string;
  provider: string;
  context: number;
  pricing: {
    prompt: number;
    completion: number;
  };
}

interface SetupState {
  // Step 1: API Key
  apiKey: string;
  showApiKey: boolean;
  isValidating: boolean;
  validationError: string | null;
  isMockMode: boolean;
  isValidated: boolean;

  // Step 2: Players
  players: Player[];
  availableModels: Model[];

  // Step 3: Settings
  settings: GameSettings;

  // Wizard navigation
  currentStep: number;

  // Actions
  setApiKey: (key: string) => void;
  toggleShowApiKey: () => void;
  setValidating: (validating: boolean) => void;
  setValidationError: (error: string | null) => void;
  setMockMode: (mock: boolean) => void;
  setValidated: (validated: boolean) => void;
  setAvailableModels: (models: Model[]) => void;

  addPlayer: () => void;
  removePlayer: (id: string) => void;
  updatePlayer: (id: string, updates: Partial<Player>) => void;
  setAllPlayerModels: (model: string) => void;

  updateSettings: (updates: Partial<GameSettings>) => void;

  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;

  reset: () => void;
}

const greekLetters = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'];

const createDefaultPlayers = (): Player[] => {
  return greekLetters.slice(0, 5).map((name, index) => ({
    id: `player-${index}`,
    name: `Agent ${name}`,
    model: 'openai/gpt-4o-mini', // Default to reliable model
  }));
};

const defaultSettings: GameSettings = {
  speedMode: 'realtime',
  actionDelay: 2.0,
  showThoughts: true,
  revealRoles: false,
  showVoteHistory: true,
  maxRetries: 3,
  temperature: 0.7,
  maxTokens: 1500,
  costLimit: 1.0, // Default $1 limit
};

export const useSetupStore = create<SetupState>()(
  persist(
    (set, get) => ({
      // Initial state
      apiKey: '',
      showApiKey: false,
      isValidating: false,
      validationError: null,
      isMockMode: false,
      isValidated: false,
      players: createDefaultPlayers(),
      availableModels: [],
      settings: defaultSettings,
      currentStep: 1,

      // Actions
      setApiKey: (key) => set({ apiKey: key, validationError: null }),
      toggleShowApiKey: () => set((state) => ({ showApiKey: !state.showApiKey })),
      setValidating: (validating) => set({ isValidating: validating }),
      setValidationError: (error) => set({ validationError: error }),
      setMockMode: (mock) => set({ isMockMode: mock, isValidated: mock }),
      setValidated: (validated) => set({ isValidated: validated }),
      setAvailableModels: (models) => set({ availableModels: models }),

      addPlayer: () => {
        const { players } = get();
        if (players.length >= 10) return;

        const nextIndex = players.length;
        const name = greekLetters[nextIndex] || `Player ${nextIndex + 1}`;

        set({
          players: [
            ...players,
            {
              id: `player-${Date.now()}`,
              name: `Agent ${name}`,
              model: 'meta-llama/llama-3.1-8b-instruct',
            },
          ],
        });
      },

      removePlayer: (id) => {
        const { players } = get();
        if (players.length <= 5) return;
        set({ players: players.filter((p) => p.id !== id) });
      },

      updatePlayer: (id, updates) => {
        set({
          players: get().players.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        });
      },

      setAllPlayerModels: (model) => {
        set({
          players: get().players.map((p) => ({ ...p, model })),
        });
      },

      updateSettings: (updates) => {
        set({ settings: { ...get().settings, ...updates } });
      },

      setStep: (step) => set({ currentStep: step }),
      nextStep: () => set((state) => ({ currentStep: Math.min(state.currentStep + 1, 4) })),
      prevStep: () => set((state) => ({ currentStep: Math.max(state.currentStep - 1, 1) })),

      reset: () => set({
        apiKey: '',
        showApiKey: false,
        isValidating: false,
        validationError: null,
        isMockMode: false,
        isValidated: false,
        players: createDefaultPlayers(),
        settings: defaultSettings,
        currentStep: 1,
      }),
    }),
    {
      name: 'sh-setup-storage',
      partialize: (state) => ({
        apiKey: state.apiKey,
        players: state.players,
        settings: state.settings,
        isMockMode: state.isMockMode,
      }),
    }
  )
);
