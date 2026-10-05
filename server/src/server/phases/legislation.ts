// Legislative session: President discards, Chancellor enacts or proposes a veto

import { drawCards, presidentDiscard, chancellorEnact, proposeVeto, respondToVeto, isVetoUnlocked } from '../../game/engine.js';
import type { PolicyCard } from '../../game/types.js';
import { getPresidentLegislationPrompt, getChancellorLegislationPrompt, getVetoResponsePrompt } from '../../ai/prompts.js';
import type { GameRecord } from '../gameRecord.js';
import { createEvent, createSnapshot } from '../state.js';
import { askForDecision, recordDialogue, publishEvent, formatTracks, type LLMClient, type Emit, type TrackCost, type Validation } from '../conversation.js';

// The card index a player chose, or null if it isn't a valid index
function cardIndex(raw: unknown, cardCount: number): number | null {
  const index = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < cardCount ? index : null;
}

const summarize = (cards: PolicyCard[]) => cards.map((c) => (c === 'liberal' ? 'L' : 'F')).join('');

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

  const { value: discardIndex } = await askForDecision(game, llmClient, emit, trackCost, president,
    getPresidentLegislationPrompt(game.state, cards), 'legislation_president', (r) => {
      const index = cardIndex(r.action?.index, 3);
      return index !== null ? { ok: true, value: index } : { ok: false, error: '"index" must be 0, 1 or 2 (the card to discard).' };
    });
  // NOTE: No dialogue during legislation - it's done in silence per rules

  const discardedCard = cards[discardIndex];
  const passedCards = cards.filter((_, i) => i !== discardIndex);
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

  createSnapshot(game, `Round ${game.state.round}: President discarded ${summarize([discardedCard])}, passed ${summarize(passedCards)}`, {
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

  const canVeto = isVetoUnlocked(game.state) && !game.state.vetoRefused;
  const { response, value: choice } = await askForDecision(game, llmClient, emit, trackCost, chancellor,
    getChancellorLegislationPrompt(game.state, cards), 'legislation_chancellor', (r): Validation<'veto' | number> => {
      if (r.action?.type === 'veto') {
        return canVeto
          ? { ok: true, value: 'veto' }
          : { ok: false, error: game.state.vetoRefused ? 'the President already refused a veto; you must enact a policy.' : 'veto power is not unlocked yet (it needs 5 Fascist policies).' };
      }
      const index = cardIndex(r.action?.index, 2);
      return index !== null ? { ok: true, value: index } : { ok: false, error: '"index" must be 0 or 1 (the card to enact).' };
    });

  // Veto proposal: public request to the President instead of enacting
  if (choice === 'veto') {
    game.state = proposeVeto(game.state);
    const request = response.dialogue || 'I wish to veto this agenda.';
    createEvent(game, 'veto_proposed', { playerId: chancellor.id, playerName: chancellor.name, cards });
    createEvent(game, 'dialogue', { playerId: chancellor.id, playerName: chancellor.name, content: request });
    publishEvent(game, `Chancellor ${chancellor.name} proposed to veto this agenda.`);
    publishEvent(game, `${chancellor.name}: "${request}"`, chancellor.id);
    emit('dialogue', { playerId: chancellor.id, playerName: chancellor.name, content: request });
    emit('veto_proposed', { chancellorName: chancellor.name });
    return;
  }

  // NOTE: No dialogue during legislation - it's done in silence per rules

  const enactIndex = choice;
  const policy = cards[enactIndex];
  const discardedCard = cards[1 - enactIndex];
  game.state = chancellorEnact(game.state, enactIndex);
  publishEvent(game, `Chancellor ${chancellor.name} enacted a ${policy.toUpperCase()} policy. ${formatTracks(game.state)}`);
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
}

export async function handleVetoResponse(
  game: GameRecord,
  llmClient: LLMClient,
  emit: Emit,
  trackCost: TrackCost
) {
  const president = game.state.players[game.state.presidentIndex];
  const cards = game.state.drawnCards;

  const { response, value: accept } = await askForDecision(game, llmClient, emit, trackCost, president,
    getVetoResponsePrompt(game.state), 'veto_proposed', (r) =>
      typeof r.action?.accept === 'boolean'
        ? { ok: true, value: r.action.accept }
        : { ok: false, error: '"accept" must be true or false.' });
  if (response.dialogue) recordDialogue(game, emit, president, response.dialogue);

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
