// Legislative session: President discards, Chancellor enacts or proposes a veto

import { drawCards, presidentDiscard, chancellorEnact, proposeVeto, respondToVeto, isVetoUnlocked } from '../../game/engine.js';
import type { ChatMessage } from '../../ai/openrouter.js';
import { getPresidentLegislationPrompt, getChancellorLegislationPrompt, getVetoResponsePrompt } from '../../ai/prompts.js';
import type { GameRecord } from '../gameRecord.js';
import { createEvent, createSnapshot } from '../state.js';
import { askPlayer, publishEvent, tellPrivately, formatTracks, type LLMClient, type Emit, type TrackCost } from '../conversation.js';

export async function handlePresidentLegislation(
  game: GameRecord,
  llmClient: LLMClient,
  emit: Emit,
  trackCost: TrackCost
) {
  const president = game.state.players[game.state.presidentIndex];

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

export async function handleVetoResponse(
  game: GameRecord,
  llmClient: LLMClient,
  emit: Emit,
  trackCost: TrackCost
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
