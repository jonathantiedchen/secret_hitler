// Presidential powers: investigate, special election, peek, execution

import { executePlayer, investigatePlayer, specialElection, finishPolicyEnacted, peekCards } from '../../game/engine.js';
import { getExecutiveAction } from '../../game/types.js';
import { getExecutionPrompt, getInvestigationPrompt, getSpecialElectionPrompt, getInvestigationClaimPrompt, getPeekClaimPrompt } from '../../ai/prompts.js';
import type { GameRecord } from '../gameRecord.js';
import { createEvent } from '../state.js';
import { askPlayer, publishEvent, tellPrivately, type LLMClient, type Emit, type TrackCost } from '../conversation.js';
import { askClaim } from './claims.js';

export async function handleExecutiveAction(
  game: GameRecord,
  llmClient: LLMClient,
  emit: Emit,
  trackCost: TrackCost
) {
  const president = game.state.players[game.state.presidentIndex];
  const action = getExecutiveAction(game.state.players.length, game.state.fascistPolicies);

  if (!action) {
    game.state = finishPolicyEnacted(game.state);
    return;
  }

  // Peek needs no decision: the president just learns the top 3 cards
  if (action === 'peek') {
    const peeked = peekCards(game.state);
    tellPrivately(game, president.id, `Policy peek: the top 3 cards of the deck are ${peeked.map((c) => c.toUpperCase()).join(', ')}.`);
    publishEvent(game, `President ${president.name} used the policy peek power and looked at the top 3 cards.`);
    createEvent(game, 'peek', { presidentId: president.id, cards: peeked });
    await askClaim(game, llmClient, emit, trackCost, president, {
      claimType: 'peek',
      prompt: getPeekClaimPrompt(peeked),
      field: 'cards',
      actual: peeked,
      announce: (claimed) => `the top 3 cards are ${claimed.join(', ')}`,
    });
    game.state = finishPolicyEnacted(game.state);
    return;
  }

  let prompt: string;
  switch (action) {
    case 'execution':
      prompt = getExecutionPrompt(game.state);
      break;
    case 'investigate':
      prompt = getInvestigationPrompt(game.state);
      break;
    case 'special_election':
      prompt = getSpecialElectionPrompt(game.state);
      break;
    default:
      game.state = finishPolicyEnacted(game.state);
      return;
  }

  createEvent(game, 'thinking', { playerId: president.id, playerName: president.name });
  emit('thinking', { playerId: president.id, playerName: president.name });

  const { response, prompt: messages } = await askPlayer(game, llmClient, president, prompt);

  // Track cost
  trackCost(response.cost);

  // Emit debug info
  emit('debug', {
    playerId: president.id,
    playerName: president.name,
    model: president.model,
    phase: 'executive_action',
    action,
    prompt: messages,
    response: response.content,
  });

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

    const targetName = parsed.action?.target;
    const targetIndex = game.state.players.findIndex(
      (p) => p.name.toLowerCase() === targetName?.toLowerCase()
    );

    if (targetIndex >= 0) {
      switch (action) {
        case 'execution':
          game.state = executePlayer(game.state, targetIndex);
          createEvent(game, 'execution', {
            presidentId: president.id,
            targetId: game.state.players[targetIndex].id,
            targetName: game.state.players[targetIndex].name,
            targetRole: game.state.players[targetIndex].role,
          });
          publishEvent(game, `President ${president.name} executed ${game.state.players[targetIndex].name}.`);
          emit('execution', { target: game.state.players[targetIndex].name });
          break;
        case 'investigate':
          const result = investigatePlayer(game.state, targetIndex);
          game.state = result.game;
          createEvent(game, 'investigation', {
            presidentId: president.id,
            targetId: game.state.players[targetIndex].id,
            targetName: game.state.players[targetIndex].name,
            revealedParty: result.party,
          });
          publishEvent(game, `President ${president.name} investigated ${game.state.players[targetIndex].name}'s party membership.`);
          tellPrivately(game, president.id, `Investigation result: ${game.state.players[targetIndex].name} is a ${result.party.toUpperCase()}.`);
          {
            const target = game.state.players[targetIndex];
            await askClaim(game, llmClient, emit, trackCost, president, {
              claimType: 'investigation',
              prompt: getInvestigationClaimPrompt(target.name, result.party),
              field: 'party',
              actual: [result.party],
              targetId: target.id,
              announce: (claimed) => `${target.name} is a ${claimed[0]}`,
            });
          }
          emit('investigation', {
            target: game.state.players[targetIndex].name,
            party: result.party,
          });
          break;
        case 'special_election':
          game.state = specialElection(game.state, targetIndex);
          createEvent(game, 'special_election', {
            presidentId: president.id,
            targetId: game.state.players[targetIndex].id,
            targetName: game.state.players[targetIndex].name,
          });
          publishEvent(game, `President ${president.name} called a special election: ${game.state.players[targetIndex].name} is the next President.`);
          emit('special_election', { target: game.state.players[targetIndex].name });
          break;
      }
    }
  } catch (e) {
    console.error('Executive action error:', e);
    game.state = finishPolicyEnacted(game.state);
  }
}
