# Setup Screen UI Specification

**Feature:** Setup Wizard for Secret Hitler LLM Arena
**Date:** 2026-04-16
**Status:** Ready for Implementation

## Overview

The Setup Screen is a 4-step wizard that guides users through configuring a new game. It collects:
1. OpenRouter API credentials (or enables mock mode)
2. Player configuration (5-10 AI players with model assignments)
3. Game settings (timing, display options, LLM behavior)
4. Final review before starting

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Visual Style | Clean & Modern | Light theme, minimal UI, professional - focus on usability |
| Layout | Step-by-Step Wizard | Guided flow reduces cognitive load for new users |
| Component Library | Custom Tailwind | No external UI library - full control, smaller bundle |

## Wizard Flow

```
Step 1: API Key    →    Step 2: Players    →    Step 3: Settings    →    Step 4: Start
     │                        │                       │                       │
     ├─ API key input         ├─ Player list          ├─ Speed mode           ├─ Summary cards
     ├─ Mock mode toggle      ├─ Model dropdowns      ├─ Display toggles      ├─ Cost estimate
     └─ Validate button       ├─ Quick-fill presets   ├─ LLM config           └─ Start button
                              └─ Add/remove players   └─ Back/Continue nav
```

## Screen Specifications

### Step 1: API Key

**Purpose:** Connect to OpenRouter or enable mock mode

**Components:**
- Header with title and subtitle
- Progress indicator (step 1 active)
- API key input field (monospace, password-style with show/hide toggle)
- Link to openrouter.ai/keys
- Mock mode button (dashed border style)
- Validate & Continue button

**Behavior:**
- `Validate & Continue`: Calls OpenRouter API to verify key, fetches model list on success
- `Mock Mode`: Skips validation, uses mock bots with random responses
- API key persists to localStorage (client-only, never sent to our server)
- Error state: Red border + error message on invalid key

**State:**
```typescript
interface Step1State {
  apiKey: string;
  showApiKey: boolean;
  isValidating: boolean;
  validationError: string | null;
  isMockMode: boolean;
}
```

### Step 2: Players

**Purpose:** Configure 5-10 AI players with model assignments

**Components:**
- Progress indicator (step 1 complete, step 2 active)
- Quick-fill preset buttons:
  - "All Llama 8B" - budget option
  - "All Mistral" - budget option
  - "Mixed Budget" - variety of cheap models
  - "Mixed Premium" - includes GPT-4, Claude, etc.
- Player list (scrollable if many players):
  - Number badge (1-10)
  - Name input (editable, default: Greek letters)
  - Model dropdown (searchable, grouped by provider)
  - Remove button (only if > 5 players)
- Add Player button (only if < 10 players)
- Back / Continue navigation

**Behavior:**
- Quick-fill presets populate all current players with specified models
- Model dropdown is searchable, grouped: OpenAI, Anthropic, Meta, Google, Mistral, etc.
- Default names: Alpha, Beta, Gamma, Delta, Epsilon, Zeta, Eta, Theta, Iota, Kappa
- Minimum 5 players required (Continue disabled otherwise)
- Maximum 10 players allowed

**State:**
```typescript
interface Player {
  id: string;
  name: string;
  model: string;  // e.g., "meta-llama/llama-3.1-8b"
}

interface Step2State {
  players: Player[];  // 5-10 players
  availableModels: Model[];  // fetched from OpenRouter
}
```

### Step 3: Settings

**Purpose:** Configure game timing, display options, and LLM behavior

**Sections:**

#### Timing
- **Speed Mode** dropdown:
  - "Realtime (delays)" - shows delay slider
  - "Fast (no delays)" - hides slider, runs at max speed
- **Action delay** slider: 0.5s - 5s (only shown in Realtime mode)

#### Display
- **Show AI Thoughts** toggle (default: ON) - Display internal reasoning
- **Reveal Roles to Viewer** toggle (default: OFF) - Show role badges in UI (AI players never see this)
- **Vote History Panel** toggle (default: ON) - Show voting patterns sidebar

#### LLM Behavior
- **Max Retries** dropdown: 1, 2, 3, 5 (default: 3)
- **Temperature** dropdown: 0.3 (focused), 0.7 (balanced), 1.0 (creative)

**State:**
```typescript
interface Step3State {
  speedMode: 'realtime' | 'fast';
  actionDelay: number;  // 0.5 - 5.0 seconds
  showThoughts: boolean;
  revealRoles: boolean;
  showVoteHistory: boolean;
  maxRetries: number;
  temperature: number;
}
```

### Step 4: Review & Start

**Purpose:** Final review before launching the game

**Components:**
- Progress indicator (all steps complete)
- Summary cards (each with Edit button to jump back):
  - **API Status**: Connection verified, masked key preview
  - **Players**: Count, role distribution, player pills with models
  - **Settings**: Key settings summary in one line
- Cost estimate panel (yellow background):
  - Shows estimated cost range per game
  - In mock mode: "Mock Mode - No API costs"
- Large "Start Game" button
- Back to Settings link

**Role Distribution (per game rules):**
| Players | Liberals | Fascists | Hitler |
|---------|----------|----------|--------|
| 5-6     | 3-4      | 1        | 1      |
| 7-8     | 4-5      | 2        | 1      |
| 9-10    | 5-6      | 3        | 1      |

**Cost Estimate Logic:**
- Based on average tokens per action (~500 input, ~150 output)
- Expected actions per game: 50-200 depending on game length
- Varies significantly by model (Llama 8B ~$0.02, GPT-4o ~$0.15)

## Component Design

### Progress Indicator

```
[ ✓ API Key ] ─── [ 2 Players ] ─── [ 3 Settings ] ─── [ 4 Start ]
   green            black             gray               gray
```

- Completed steps: Green circle with checkmark, green text
- Current step: Black circle with number, black bold text
- Future steps: Gray circle with number, gray text
- Connectors: Green (completed), gray (pending)

### Toggle Switch

```
ON:  [ ●─────○ ] background: #111
OFF: [ ○─────● ] background: #e5e5e5
```

- Width: 44px, Height: 24px
- Knob: 20px circle
- Transition: 150ms ease-out

### Card Container

```css
.card {
  max-width: 560px;
  margin: 0 auto;
  background: #fafafa;
  border: 1px solid #e5e5e5;
  border-radius: 12px;
  padding: 32px;
}
```

### Primary Button

```css
.btn-primary {
  padding: 14px 24px;
  background: #111;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
}
```

### Secondary Button

```css
.btn-secondary {
  padding: 14px 24px;
  background: white;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
}
```

## Data Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Step 1    │────▶│   Step 2    │────▶│   Step 3    │────▶│   Step 4    │
│  API Key    │     │   Players   │     │  Settings   │     │   Start     │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │                   │
       ▼                   ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Zustand Store: useSetupStore                    │
│  - apiKey, isMockMode, isValidated                                      │
│  - players: Player[]                                                    │
│  - settings: GameSettings                                               │
│  - currentStep: 1-4                                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ on Start
┌─────────────────────────────────────────────────────────────────────────┐
│                         POST /api/games/create                          │
│  { apiKey, players, settings }  →  { gameId }                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ redirect
                            /game/:gameId (Game Screen)
```

## Validation Rules

| Field | Rule | Error Message |
|-------|------|---------------|
| API Key | Required unless mock mode | "API key is required" |
| API Key | Must start with "sk-or-" | "Invalid API key format" |
| API Key | Must validate with OpenRouter | "API key validation failed" |
| Players | Minimum 5 | "At least 5 players required" |
| Players | Maximum 10 | "Maximum 10 players allowed" |
| Player Name | Required, non-empty | "Player name required" |
| Player Name | Unique | "Player names must be unique" |
| Player Model | Required | "Select a model for each player" |

## Persistence

Store to localStorage:
- `sh_api_key`: Encrypted API key (or empty string for mock)
- `sh_setup_players`: JSON array of last used player configs
- `sh_setup_settings`: JSON object of last used settings

Load on mount to restore previous session state.

## Accessibility

- All form inputs have associated labels
- Focus states visible on all interactive elements
- Keyboard navigation: Tab through inputs, Enter to submit
- Progress indicator has aria-current for screen readers
- Color contrast meets WCAG AA standards

## Model Dropdown Structure

The model dropdown groups models by provider for easier navigation:

```typescript
interface ModelGroup {
  provider: string;  // "OpenAI", "Anthropic", etc.
  models: {
    id: string;      // "openai/gpt-4o"
    name: string;    // "GPT-4o"
    context: number; // 128000
    pricing: {
      prompt: number;    // per 1M tokens
      completion: number;
    };
  }[];
}

// Suggested default order (budget-first):
const providerOrder = [
  "Meta",       // Llama models (cheapest)
  "Mistral",    // Mistral models
  "Google",     // Gemma models
  "Anthropic",  // Claude models
  "OpenAI",     // GPT models (most expensive)
];
```

## Implementation Files

```
src/
├── pages/
│   └── SetupPage.tsx           # Main setup wizard container
├── components/
│   └── setup/
│       ├── ProgressIndicator.tsx
│       ├── Step1ApiKey.tsx
│       ├── Step2Players.tsx
│       ├── Step3Settings.tsx
│       ├── Step4Start.tsx
│       ├── PlayerRow.tsx
│       ├── ModelDropdown.tsx
│       └── ToggleSwitch.tsx
├── stores/
│   └── setupStore.ts           # Zustand store for wizard state
└── hooks/
    └── useOpenRouter.ts        # API key validation, model fetching
```

## Mockups

Visual mockups are available in the brainstorm session:
- `.superpowers/brainstorm/82469-1776327315/content/step1-api-key.html`
- `.superpowers/brainstorm/82469-1776327315/content/step2-players.html`
- `.superpowers/brainstorm/82469-1776327315/content/step3-settings.html`
- `.superpowers/brainstorm/82469-1776327315/content/step4-start.html`

To view: Run the brainstorm server and open http://localhost:51372
