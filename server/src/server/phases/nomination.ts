// Nomination: the President picks a Chancellor

import { nominate, getValidChancellorCandidates } from '../../game/engine.js';
import type { ChatMessage } from '../../ai/openrouter.js';
import { getNominationPrompt } from '../../ai/prompts.js';
import type { GameRecord } from '../gameRecord.js';
import { createEvent } from '../state.js';
import { askPlayer, publishEvent, type LLMClient, type Emit, type TrackCost } from '../conversation.js';

export async function handleNomination(
  game: GameRecord,
  llmClient: LLMClient,
  emit: Emit,
  trackCost: TrackCost
) {
  const president = game.state.players[game.state.presidentIndex];
  const validCandidates = getValidChancellorCandidates(game.state);

  const nominationPrompt = getNominationPrompt(game.state, validCandidates);

  createEvent(game, 'thinking', { playerId: president.id, playerName: president.name });
  emit('thinking', { playerId: president.id, playerName: president.name });

  let response;
  try {
    let prompt: ChatMessage[];
    ({ response, prompt } = await askPlayer(game, llmClient, president, nominationPrompt));

    // Track cost
    trackCost(response.cost);

    // Emit debug info
    emit('debug', {
      playerId: president.id,
      playerName: president.name,
      model: president.model,
      phase: 'nomination',
      prompt,
      response: response.content,
    });
  } catch (apiError) {
    console.error(`API error for ${president.name} (${president.model}):`, apiError);
    // Fallback on API error: pick random valid candidate
    const randomIndex = validCandidates[Math.floor(Math.random() * validCandidates.length)];
    game.state = nominate(game.state, randomIndex);
    publishEvent(game, `President ${president.name} nominated ${game.state.players[randomIndex].name} as Chancellor.`);
    emit('action', {
      type: 'nominate',
      actor: president.name,
      target: game.state.players[randomIndex].name,
    });
    return;
  }

  try {
    const parsed = JSON.parse(response.content);

    // Emit thought
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

    // Emit dialogue
    if (parsed.dialogue) {
      createEvent(game, 'dialogue', {
        playerId: president.id,
        playerName: president.name,
        content: parsed.dialogue,
      });
      publishEvent(game, `${president.name}: "${parsed.dialogue}"`, president.id);
      emit('dialogue', {
        playerId: president.id,
        playerName: president.name,
        content: parsed.dialogue,
      });
    }

    // Execute action
    if (parsed.action?.type === 'nominate' && parsed.action.target) {
      const targetIndex = game.state.players.findIndex(
        (p) => p.name.toLowerCase() === parsed.action.target.toLowerCase()
      );

      if (targetIndex >= 0 && validCandidates.includes(targetIndex)) {
        game.state = nominate(game.state, targetIndex);
        publishEvent(game, `President ${president.name} nominated ${game.state.players[targetIndex].name} as Chancellor.`);
        createEvent(game, 'nomination', {
          presidentId: president.id,
          presidentName: president.name,
          nomineeId: game.state.players[targetIndex].id,
          nomineeName: game.state.players[targetIndex].name,
        });
        emit('action', {
          type: 'nominate',
          actor: president.name,
          target: game.state.players[targetIndex].name,
        });
      }
    }
  } catch (e) {
    console.error('Failed to parse nomination response:', e);
    // Fallback: pick random valid candidate
    const randomIndex = validCandidates[Math.floor(Math.random() * validCandidates.length)];
    game.state = nominate(game.state, randomIndex);
    publishEvent(game, `President ${president.name} nominated ${game.state.players[randomIndex].name} as Chancellor.`);
    createEvent(game, 'nomination', {
      presidentId: president.id,
      presidentName: president.name,
      nomineeId: game.state.players[randomIndex].id,
      nomineeName: game.state.players[randomIndex].name,
      fallback: true,
    });
    emit('action', {
      type: 'nominate',
      actor: president.name,
      target: game.state.players[randomIndex].name,
    });
  }
}
