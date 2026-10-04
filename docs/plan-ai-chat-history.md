# Plan: Per-Player AI Chat History

## Goal

Give each AI player a persistent conversation with the LLM that spans the whole
game. The model sees its own prior `assistant` messages (thoughts, dialogue,
actions) and a stream of `user` messages narrating what happened publicly while
it wasn't acting. Today, every handler rebuilds a fresh 2-message
`[system, user]` array, so each LLM call starts cold.

## Design

### Data model (server)

Add to the game record in `server/src/index.ts`:

```ts
playerMessages: Map<string, ChatMessage[]>;     // playerId -> conversation
publicEventsBuffer: ChatMessage[];              // pending observations
```

- `playerMessages` is keyed by `playerId`. Seeded on game creation with the
  system prompt as the only entry: `[{ role: 'system', content: getSystemPrompt(...) }]`.
- `publicEventsBuffer` is a list of `user`-role messages describing public
  events that happened since the last LLM call. Drained into players' histories
  at the right moments (see below).

### When a player acts

Replace the current `[system, user]` construction with:

1. Drain `publicEventsBuffer` -> append each entry to the acting player's
   history as a `user` message (so they see what happened since their last
   turn).
2. Append a fresh `user` message containing the action-specific prompt
   (nomination prompt, voting prompt, legislation prompt, etc.) plus a compact
   "current state" header (policies, who's president, who's alive).
3. Call `llmClient.chat(model, history, ...)`.
4. Append `{ role: 'assistant', content: response.content }` to that player's
   history.
5. The `emit('debug', { prompt: history, response })` payload now carries the
   full accumulated array - DebugPanel already renders `ChatMessage[]`, so the
   UI shows the running memory for free.

### Public events that get buffered

Each of these, when emitted, also pushes a `user` message into
`publicEventsBuffer`:

- **dialogue** — `"[PlayerName]: <dialogue>"`
- **nomination** — `"President [P] nominated [C] as Chancellor."`
- **vote_result** — `"Vote on [C]: <perPlayerVotes>. Result: PASSED/FAILED."`
- **policy_enacted** — `"A LIBERAL/FASCIST policy was enacted. (Tracks: L/5, F/6.)"`
- **execution** — `"[President] executed [Target]."`
- **investigation** — `"[President] investigated [Target]." `(party result is private to the investigator and threaded into *their* history directly)
- **special_election** — `"[President] called a special election: [Target] is next President."`
- **chaos / election failed** — `"Election failed (tracker N/3)."` / `"Chaos: A [policy] was auto-enacted."`

The buffer is global; each player drains it just before their next action. This
means each player sees public events exactly once, in order, when it's their
turn. (A player who never acts again won't see events past their last turn -
fine, they're dead.)

### Things that are private to one player

- President's drawn cards in legislation
- Chancellor's received cards in legislation
- Investigation result (the party)
- Peek result

These go straight into that one player's history as a `user` message at the
moment the engine learns them, *not* through the public buffer.

### Token-budget cap

Simple FIFO. After each append, if `playerMessages[playerId].length` exceeds
`maxHistoryMessages` (default **40**), drop oldest non-system messages until
it's back to the cap. System message stays pinned at index 0.

Configurable via game settings:
```ts
settings.maxHistoryMessages: number;   // default 40
```

### System prompt

Stays unchanged in content. Now persisted once at game start instead of rebuilt
every call. (`getSystemPrompt` is deterministic given `player` and
`allPlayers`, so this is a no-op behavior change.)

### Game-state context (`buildGameContext`)

Today every prompt re-injects the full current-state blob. With persistent
history that's redundant on most turns. Compromise: include a **short** state
header on every action prompt (round number, policy tracks, current
president/chancellor, alive players), but drop the rest. The accumulated
history carries the rest.

## Files touched

- `server/src/index.ts` — add `playerMessages` + `publicEventsBuffer` to game
  record, wire into game creation, refactor all 5 handlers
  (`handleNomination`, `handleVoting`, `handlePresidentLegislation`,
  `handleChancellorLegislation`, `handleExecutiveAction`), add buffer-push
  calls next to relevant `emit(...)` sites.
- `server/src/ai/prompts.ts` — shorten `buildGameContext` (or add a new
  `buildStateHeader`) so per-turn prompts aren't bloated.
- `server/src/game/engine.ts` — no changes (engine stays pure).

Client doesn't need changes — `DebugPanel` already takes `ChatMessage[]`.

## Out of scope

- Summarization / compression. FIFO is enough for now.
- Persisting chat histories across server restarts (games are already
  in-memory).
- Showing the chat history in the analysis page (separate task).
- "Night phase" reveal of fellow Fascists as an explicit message — currently
  the system prompt already names them; leaving as-is.

## Verification

- Start a 5-player mock game (`MockLLMClient`), run to completion, inspect
  DebugPanel for a mid-game player: their `prompt` array should grow turn over
  turn, contain prior `assistant` responses, and contain public-event `user`
  messages from other players' turns.
- Trigger an execution; the executed player's history stops growing
  (no further actions), surviving players see the execution event in their
  next turn.
- Run with `maxHistoryMessages: 6` to force truncation and confirm system
  prompt stays pinned while oldest pairs drop.
