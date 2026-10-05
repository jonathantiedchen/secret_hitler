// Legislative session: President discards, Chancellor enacts or proposes a veto

import { drawCards, presidentDiscard, chancellorEnact, proposeVeto, respondToVeto, isVetoUnlocked } from '../../game/engine.js';
import type { Player, PolicyCard } from '../../game/types.js';
import { getPresidentLegislationPrompt, getChancellorLegislationPrompt, getVetoResponsePrompt } from '../../ai/prompts.js';
import type { GameRecord } from '../gameRecord.js';
import { createEvent, createSnapshot } from '../state.js';
import { askPlayer, publishEvent, tellPrivately, formatTracks, type LLMClient, type Emit, type TrackCost } from '../conversation.js';

interface PlayerResponse {
  thought?: string;
  dialogue?: string;
  action?: Record<string, unknown>;
}

// Ask a player for their legislative decision and record their private thought.
// Returns the parsed response, or null if the request failed or the reply wasn't valid JSON.
async function askLegislator(
  game: GameRecord,
  llmClient: LLMClient,
  emit: Emit,
  trackCost: TrackCost,
  player: Player,
  prompt: string,
  phase: string
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

// The card index a player chose, or null if it isn't a valid index (the caller falls back to card 0)
function cardIndex(raw: unknown, cardCount: number): number | null {
  const index = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < cardCount ? index : null;
}

const summarize = (cards: PolicyCard[]) => cards.map((c) => (c === 'liberal' ? 'L' : 'F')).join('');
const upper = (cards: PolicyCard[]) => cards.map((c) => c.toUpperCase()).join(', ');

export async function handlePresidentLegislation(
  game: GameRecord,
  llmClient: LLMClient,
  emit: Emit,
  trackCost: TrackCost
) {
  const president = game.state.players[game.state.presidentIndex];
  const chancellor = game.state.players[game.state.chancellorIndex!];

  // Draw cards
  game.state = drawCards(game.state);
  const cards = game.state.drawnCards;
  game.legislation = {
    presidentId: president.id,
    presidentCards: [...cards],
    chancellorId: null,
    chancellorCards: null,
    liberalPoliciesBefore: game.state.liberalPolicies,
  };

  createEvent(game, 'cards_drawn', { playerId: president.id, cards: [...cards] });
  emit('cards_drawn', { playerId: president.id, cards });

  createSnapshot(game, `Round ${game.state.round}: President drew ${summarize(cards)}`, {
    legislation: { presidentCards: cards, discardedCard: null, chancellorCards: [] },
  });
  emit('history_nav', { currentIndex: null, totalSnapshots: game.snapshots.length, isLive: true });

  const parsed = await askLegislator(game, llmClient, emit, trackCost, president,
    getPresidentLegislationPrompt(game.state, cards), 'legislation_president');
  // NOTE: No dialogue during legislation - it's done in silence per rules

  const chosen = cardIndex(parsed?.action?.index, 3);
  const discardIndex = chosen ?? 0;
  const fallback = chosen === null;
  const discardedCard = cards[discardIndex];
  const passedCards = cards.filter((_, i) => i !== discardIndex);

  game.state = presidentDiscard(game.state, discardIndex);
  if (fallback) {
    tellPrivately(game, president.id, `Your response could not be used, so the first card was discarded for you: you drew ${upper(cards)} and discarded ${discardedCard.toUpperCase()}.`);
  }
  createEvent(game, 'president_discard', {
    playerId: president.id,
    discardIndex,
    discardedCard,
    passedCards,
    ...(fallback && { fallback: true }),
  });
  emit('president_discard', {
    discardIndex,
    discardedCard,
    passedCards,
    presidentName: president.name,
    chancellorName: chancellor.name,
  });

  createSnapshot(game, `Round ${game.state.round}: President discarded ${summarize([discardedCard])}, passed ${summarize(passedCards)}${fallback ? ' (fallback)' : ''}`, {
    legislation: { presidentCards: cards, discardedCard, chancellorCards: passedCards },
  });
  emit('history_nav', { currentIndex: null, totalSnapshots: game.snapshots.length, isLive: true });
}

export async function handleChancellorLegislation(
  game: GameRecord,
  llmClient: LLMClient,
  emit: Emit,
  trackCost: TrackCost
) {
  const chancellor = game.state.players[game.state.chancellorIndex!];
  const cards = game.state.drawnCards;
  if (game.legislation) {
    game.legislation.chancellorId = chancellor.id;
    game.legislation.chancellorCards = [...cards];
  }

  emit('cards_received', { playerId: chancellor.id, cards });

  // Create snapshot with chancellor's received cards (once per session, not again after a refused veto)
  if (!game.state.vetoRefused) {
    createSnapshot(game, `Round ${game.state.round}: Chancellor received ${summarize(cards)}`, {
      legislation: { presidentCards: [], discardedCard: null, chancellorCards: cards },
    });
    emit('history_nav', { currentIndex: null, totalSnapshots: game.snapshots.length, isLive: true });
  }

  const parsed = await askLegislator(game, llmClient, emit, trackCost, chancellor,
    getChancellorLegislationPrompt(game.state, cards), 'legislation_chancellor');

  // Veto proposal: public request to the President instead of enacting
  if (parsed?.action?.type === 'veto' && isVetoUnlocked(game.state) && !game.state.vetoRefused) {
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

  const chosen = cardIndex(parsed?.action?.index, 2);
  const enactIndex = chosen ?? 0;
  const fallback = chosen === null;
  const policy = cards[enactIndex];
  const discardedCard = cards[1 - enactIndex];

  game.state = chancellorEnact(game.state, enactIndex);
  if (fallback) {
    tellPrivately(game, chancellor.id, `Your response could not be used, so the first card was enacted for you: you received ${upper(cards)} and enacted ${policy.toUpperCase()}.`);
  }
  publishEvent(game, `Chancellor ${chancellor.name} enacted a ${policy.toUpperCase()} policy. ${formatTracks(game.state)}`);
  createEvent(game, 'chancellor_enact', {
    playerId: chancellor.id,
    enactIndex,
    enactedPolicy: policy,
    discardedCard,
    ...(fallback && { fallback: true }),
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

export async function handleVetoResponse(
  game: GameRecord,
  llmClient: LLMClient,
  emit: Emit,
  trackCost: TrackCost
) {
  const president = game.state.players[game.state.presidentIndex];
  const cards = game.state.drawnCards;

  const parsed = await askLegislator(game, llmClient, emit, trackCost, president,
    getVetoResponsePrompt(game.state), 'veto_proposed');

  // Default to refusing: the agenda stands unless the President clearly agrees
  const accept = parsed?.action?.accept === true;
  if (parsed?.dialogue) {
    createEvent(game, 'dialogue', { playerId: president.id, playerName: president.name, content: parsed.dialogue });
    publishEvent(game, `${president.name}: "${parsed.dialogue}"`, president.id);
    emit('dialogue', { playerId: president.id, playerName: president.name, content: parsed.dialogue });
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
