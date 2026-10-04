# Game Screen UI Specification

**Feature:** Main Game Screen for Secret Hitler LLM Arena
**Date:** 2026-04-17
**Status:** Ready for Implementation

## Overview

The Game Screen is where users spectate AI players competing in Secret Hitler. The design prioritizes:
- Equal visibility of game state and AI reasoning
- Clean, minimal aesthetic with dark theme
- Character-based visuals with model-specific icons
- Clear indication of spectator-only information

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Game top, info bottom | Full-width game state, thoughts/log split below |
| Theme | Dark minimal | Dramatic atmosphere, reduces visual clutter |
| Player display | Horizontal row | Clean, scales to 5-10 players |
| Voting | Inline badges | Simple JA/NEIN under each player |
| Spectator info | Labeled | "👁 Spectator view" for hidden information |

## Screen Layout

```
┌────────────────────────────────────────────┬────────────────────────────┐
│  Round 4                           $0.12   │  💬 TABLE CHAT             │
├────────────────────────────────────────────┤                            │
│  Liberal 2/5  [■■□□□]  ●○○  [■■■□□□] 3/6   │  ┌──────────────────────┐  │
├────────────────────────────────────────────┤  │ 🦙 Alpha             │  │
│                                            │  │ "I trust Gamma,      │  │
│   [🦙]  [🤖]  [🔷]  [🎭]  [💎]  [🦙]  [🎭] │  │ let's vote them in." │  │
│  Alpha Beta Gamma Delta Eps  Zeta  Eta     │  └──────────────────────┘  │
│  Pres        Chanc      dead               │                            │
│                                            │  ┌──────────────────────┐  │
├────────────────────────────────────────────┤  │ 🎭 Delta             │  │
│            NOMINATION                      │  │ "Why so eager to     │  │
│     Alpha is choosing a Chancellor         │  │ push this through?"  │  │
├────────────────────────────────────────────┤  └──────────────────────┘  │
│  👁 Alpha's Thoughts                       │                            │
│  Llama 3.1 • Fascist                       │  ┌──────────────────────┐  │
│                                            │  │ ⚡ Alpha nominated   │  │
│  I need to get Hitler elected but I can't  │  │ Gamma as Chancellor  │  │
│  be obvious. Gamma seems trustworthy to    │  └──────────────────────┘  │
│  the Liberals...                           │                            │
│                                            │  ┌──────────────────────┐  │
│                                            │  │ 🤖 Beta              │  │
│                                            │  │ "Sounds reasonable." │  │
└────────────────────────────────────────────┴──└──────────────────────┘──┘

         GAME AREA (60%)                         CHAT SIDEBAR (40%)
```

**Layout: Two-column split**
- **Left (60%)**: Game state (tracks, players, phase) + thought panel
- **Right (40%)**: Chat sidebar with dialogue + actions interleaved

## Components

### Header
- Round number (left)
- Cost accumulator (right)
- Pause/speed controls (optional, hidden by default)

### Policy Tracks
Three sections horizontally centered:
- **Liberal track**: Blue squares, X/5 label
- **Election tracker**: 3 dots (filled = failed elections)
- **Fascist track**: Red squares, X/6 label

### Player Row
Horizontal arrangement of player avatars:
- **Avatar**: 48x48px rounded square with model icon
- **Model icons by provider**:
  - Llama: 🦙 (purple `#8b5cf6`)
  - GPT: 🤖 (green `#10b981`)
  - Claude: 🎭 (pink `#ec4899`)
  - Mistral: 🔷 (orange `#f97316`)
  - Gemini: 💎 (cyan `#06b6d4`)
- **States**:
  - Active: Full opacity, golden border for President, white border for Chancellor
  - Inactive: 40% opacity
  - Dead: 20% opacity, grayed out

### Phase Strip
Center-aligned current action:
- Phase name in accent color (uppercase, letter-spaced)
- Description of what's happening

### Thought Panel (Bottom Left)
- Active player's avatar + name + model + role (if revealed)
- Scrollable thought text
- Label: "👁" icon to indicate spectator-only private thoughts

**Thought selection:**
- Click any player avatar to pin their thoughts
- When pinned: stays on that player until clicked again or another player is selected
- When unpinned (default): "smart follow" based on phase:
  - Nomination → President (who's choosing)
  - Voting → Cycles through voters as they decide
  - Legislation (President) → President
  - Legislation (Chancellor) → Chancellor
  - Executive action → President
- Visual indicator: subtle glow or 👁 badge on the player whose thoughts are shown

### Chat Sidebar (Right 40%)
Unified feed combining dialogue and actions in chronological order:

**Dialogue messages** (speech bubbles):
- Player avatar + name
- What they say publicly to the table
- Other AI players see and respond to this
- Example: "I had to pass 2 Fascists - the deck gave me no choice!"

**Action events** (compact cards):
- System-style messages with ⚡ icon
- "Alpha nominated Gamma", "Vote passed 5-1", "Fascist policy enacted"
- Visually distinct from dialogue (smaller, muted)

**Three types of communication:**
| Type | Who sees it | Example |
|------|-------------|---------|
| Thoughts | Spectator only | "I need to protect Hitler..." |
| Dialogue | All AI players + spectator | "I trust Gamma, vote JA!" |
| Actions | All AI players + spectator | ⚡ Alpha nominated Gamma |

## Game States

### 1. Nomination
- President highlighted with golden border
- Phase: "Alpha is choosing a Chancellor"
- Thought panel shows President's reasoning

### 2. Voting
- All players show inline vote badges:
  - JA: Green pill badge
  - NEIN: Red pill badge
  - Can't vote (nominee/dead): "—"
- Phase shows result: "Vote Passed" (green) or "Vote Failed" (red)
- Tally: "5 JA · 1 NEIN"

### 3. Legislation
- President + Chancellor highlighted, others dimmed
- **Spectator view panel** showing:
  - Cards President drew (3)
  - Discarded card (faded)
  - Cards Chancellor received (2)
- Label: "👁 Spectator view — hidden from other players"

### 4. Policy Enacted
- Animate policy card moving to appropriate track
- Brief highlight on the track
- Log entry with policy color

### 5. Executive Action
When Fascist policies unlock powers:
- **Investigate**: President sees one player's party card
- **Special Election**: President chooses next President
- **Execution**: President eliminates a player (avatar goes dead state)
- Same spectator view pattern for hidden information

### 6. Game End
- Overlay or transition showing:
  - Winner: "Liberals Win!" or "Fascists Win!"
  - Win condition (5 Liberal policies / Hitler killed / 6 Fascist / Hitler elected)
  - Final role reveal for all players
  - Link to Analysis screen

## State Interfaces

```typescript
interface GameScreenState {
  // Game data
  gameId: string;
  round: number;
  phase: GamePhase;

  // Tracks
  liberalPolicies: number;  // 0-5
  fascistPolicies: number;  // 0-6
  failedElections: number;  // 0-3

  // Players
  players: PlayerState[];
  presidentIndex: number;
  chancellorIndex: number | null;

  // Current action
  currentAction: ActionState;

  // UI state
  pinnedThoughtPlayer: number | null;  // null = smart follow based on phase
  activeThoughtPlayer: number;         // computed: pinned or auto-selected
  isPaused: boolean;
  cost: number;
}

interface PlayerState {
  id: string;
  name: string;
  model: string;
  modelIcon: string;
  modelColor: string;
  role: Role;  // 'liberal' | 'fascist' | 'hitler'
  isAlive: boolean;
  currentVote: 'ja' | 'nein' | null;
}

type GamePhase =
  | 'nomination'
  | 'voting'
  | 'legislation_president'
  | 'legislation_chancellor'
  | 'policy_enacted'
  | 'executive_action'
  | 'game_over';

interface ActionState {
  type: string;
  actor: number;  // player index
  target?: number;
  data?: any;  // phase-specific data
}
```

## Styling

### Colors
```css
--bg-primary: #111111;
--bg-secondary: #0a0a0a;
--border: #222222;
--text-primary: #ffffff;
--text-secondary: #888888;
--text-muted: #444444;

--liberal: #3b82f6;
--liberal-bg: #1e293b;
--fascist: #dc2626;
--fascist-bg: #1f1315;

--ja: #22c55e;
--nein: #ef4444;
--president: #fbbf24;
--chancellor: #ffffff;
```

### Typography
- Phase labels: 13px uppercase, letter-spacing 2px
- Player names: 12px
- Thoughts: 13px, line-height 1.6
- Log entries: 12px

## Animation

Keep animations subtle and fast:
- Vote badges: fade in 200ms
- Policy enacted: slide to track 300ms
- Player death: fade to gray 400ms
- Phase transitions: crossfade 200ms

## Responsive Behavior

- **Desktop (1200px+)**: Full layout as designed
- **Tablet (768-1199px)**: Reduce player avatar size, stack info panels
- **Mobile (<768px)**: Not primary target, but scrollable single column

## Implementation Files

```
src/
├── pages/
│   └── GamePage.tsx
├── components/
│   └── game/
│       ├── GameHeader.tsx
│       ├── PolicyTracks.tsx
│       ├── PlayerRow.tsx
│       ├── PlayerAvatar.tsx
│       ├── PhaseStrip.tsx
│       ├── ThoughtPanel.tsx
│       ├── ChatSidebar.tsx        # Dialogue + actions feed
│       ├── DialogueMessage.tsx    # Player speech bubble
│       ├── ActionEvent.tsx        # System action card
│       ├── VoteBadge.tsx
│       ├── LegislationView.tsx
│       └── GameOverOverlay.tsx
├── stores/
│   └── gameStore.ts
└── hooks/
    └── useGameSocket.ts
```

## Mockups

Visual mockups in brainstorm session:
- `game-clean.html` - Main layout (nomination phase)
- `game-voting.html` - Voting with inline badges
- `game-legislation.html` - Legislation with spectator view

View at: http://localhost:49635
