// Each AI player's conversation: public events, private information, and LLM requests

import type { GameState, Player } from '../game/types.js';
import type { ChatMessage, OpenRouterClient, MockLLMClient } from '../ai/openrouter.js';
import { buildStateHeader } from '../ai/prompts.js';
import type { LLMCallRecord } from '../logging/gameLog.js';
import type { GameRecord, PublicEvent } from './gameRecord.js';
import { createEvent } from './state.js';

export type LLMClient = OpenRouterClient | MockLLMClient;
export type Emit = (event: string, data: unknown) => void;
export type TrackCost = (cost: number) => void;

// Append a message to a player's history, trimming oldest non-system messages (FIFO)
export function appendToHistory(game: GameRecord, playerId: string, message: ChatMessage) {
  const history = game.playerMessages.get(playerId)!;
  history.push(message);
  game.unloggedMessages.get(playerId)!.push(message);
  const cap = Math.max(2, game.settings.maxHistoryMessages);
  if (history.length > cap) {
    history.splice(1, history.length - cap);
  }
}

// Record a public event that every player will see on their next turn
export function publishEvent(game: GameRecord, content: string, authorId?: string) {
  game.publicEvents.push({ content, authorId });
}

// Information only one player learns (cards seen, investigation result, ...)
export function tellPrivately(game: GameRecord, playerId: string, content: string) {
  appendToHistory(game, playerId, { role: 'user', content: `[PRIVATE] ${content}` });
}

export function formatTracks(state: GameState): string {
  return `(Tracks: Liberal ${state.liberalPolicies}/5, Fascist ${state.fascistPolicies}/6.)`;
}

// Bring a player's history up to date and ask them to act.
// Returns the LLM response; the assistant reply is appended to their history.
export async function askPlayer(
  game: GameRecord,
  llmClient: LLMClient,
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
  const call: LLMCallRecord = {
    playerId: player.id,
    round: game.state.round,
    phase: game.state.phase,
    timestamp: Date.now(),
    newMessages: game.unloggedMessages.get(player.id)!.splice(0),
    promptMessageCount: prompt.length,
    response: null,
    model: null,
    usage: null,
    cost: 0,
    latencyMs: 0,
  };
  game.llmCalls.push(call);

  try {
    const response = await llmClient.chat(player.model, history, {
      temperature: game.settings.temperature,
      maxTokens: game.settings.maxTokens,
    });
    Object.assign(call, {
      response: response.content,
      model: response.model,
      usage: response.usage,
      cost: response.cost,
      latencyMs: Date.now() - call.timestamp,
    });
    appendToHistory(game, player.id, { role: 'assistant', content: response.content });
    // The reply is logged in this call, not as a new message for the next one
    game.unloggedMessages.get(player.id)!.pop();
    return { response, prompt };
  } catch (error) {
    call.error = error instanceof Error ? error.message : String(error);
    call.latencyMs = Date.now() - call.timestamp;
    // Drop the unanswered prompt so the next turn doesn't start with a dangling question
    history.pop();
    throw error;
  }
}

export interface PlayerResponse {
  thought?: string;
  dialogue?: string;
  action?: Record<string, unknown>;
}

// Ask a player for a decision and record their private thought.
// Returns the parsed response, or null if the request failed or the reply wasn't valid JSON.
export async function askForDecision(
  game: GameRecord,
  llmClient: LLMClient,
  emit: Emit,
  trackCost: TrackCost,
  player: Player,
  prompt: string,
  phase: string,
  debugExtra: Record<string, unknown> = {}
): Promise<PlayerResponse | null> {
  createEvent(game, 'thinking', { playerId: player.id, playerName: player.name });
  emit('thinking', { playerId: player.id, playerName: player.name });

  let parsed: PlayerResponse;
  try {
    const { response, prompt: messages } = await askPlayer(game, llmClient, player, prompt);
    trackCost(response.cost);
    emit('debug', {
      playerId: player.id,
      playerName: player.name,
      model: player.model,
      phase,
      ...debugExtra,
      prompt: messages,
      response: response.content,
    });
    parsed = JSON.parse(response.content);
  } catch (error) {
    console.error(`No usable response from ${player.name} (${player.model}) in ${phase}:`, error);
    return null;
  }

  if (parsed.thought) {
    createEvent(game, 'thought', { playerId: player.id, playerName: player.name, content: parsed.thought });
    if (game.settings.showThoughts) {
      emit('thought', { playerId: player.id, playerName: player.name, content: parsed.thought });
    }
  }
  return parsed;
}

// Record what a player said out loud. Public events go to `queue` when given (votes hold
// remarks until everyone has voted), otherwise straight to the public log.
export function recordDialogue(game: GameRecord, emit: Emit, player: Player, content: string, queue?: PublicEvent[]) {
  createEvent(game, 'dialogue', { playerId: player.id, playerName: player.name, content });
  const event = { content: `${player.name}: "${content}"`, authorId: player.id };
  if (queue) queue.push(event);
  else publishEvent(game, event.content, event.authorId);
  emit('dialogue', { playerId: player.id, playerName: player.name, content });
}

// A random element: fallback choices are random so they don't favour any seat
export function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}
