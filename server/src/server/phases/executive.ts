// Presidential powers: investigate, special election, peek, execution

import { executePlayer, investigatePlayer, specialElection, finishPolicyEnacted, peekCards, getValidTargets } from '../../game/engine.js';
import { getExecutiveAction } from '../../game/types.js';
import { getExecutionPrompt, getInvestigationPrompt, getSpecialElectionPrompt, getInvestigationClaimPrompt, getPeekClaimPrompt } from '../../ai/prompts.js';
import type { GameRecord } from '../gameRecord.js';
import { createEvent } from '../state.js';
import { askForDecision, recordDialogue, publishEvent, tellPrivately, pickRandom, type LLMClient, type Emit, type TrackCost } from '../conversation.js';
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

  const parsed = await askForDecision(game, llmClient, emit, trackCost, president, prompt, 'executive_action', { action });
  if (parsed?.dialogue) recordDialogue(game, emit, president, parsed.dialogue);

  // Powers are mandatory: an unknown or illegal target falls back to a random legal one
  const validTargets = getValidTargets(game.state, action);
  const targetName = parsed?.action?.target;
  const chosen = typeof targetName === 'string'
    ? game.state.players.findIndex((p) => p.name.toLowerCase() === targetName.toLowerCase())
    : -1;
  const fallback = !validTargets.includes(chosen);
  const targetIndex = fallback ? pickRandom(validTargets) : chosen;
  const target = game.state.players[targetIndex];
  const flag = fallback ? { fallback: true } : {};
  const tellFallback = (did: string) => {
    if (fallback) tellPrivately(game, president.id, `Your response could not be used, so a random valid target was chosen for you: you ${did}.`);
  };

  switch (action) {
    case 'execution':
      game.state = executePlayer(game.state, targetIndex);
      tellFallback(`executed ${target.name}`);
      createEvent(game, 'execution', {
        presidentId: president.id,
        targetId: target.id,
        targetName: target.name,
        targetRole: target.role,
        ...flag,
      });
      publishEvent(game, `President ${president.name} executed ${target.name}.`);
      emit('execution', { target: target.name });
      break;

    case 'investigate': {
      const result = investigatePlayer(game.state, targetIndex);
      game.state = result.game;
      tellFallback(`investigated ${target.name}`);
      createEvent(game, 'investigation', {
        presidentId: president.id,
        targetId: target.id,
        targetName: target.name,
        revealedParty: result.party,
        ...flag,
      });
      publishEvent(game, `President ${president.name} investigated ${target.name}'s party membership.`);
      tellPrivately(game, president.id, `Investigation result: ${target.name} is a ${result.party.toUpperCase()}.`);
      await askClaim(game, llmClient, emit, trackCost, president, {
        claimType: 'investigation',
        prompt: getInvestigationClaimPrompt(target.name, result.party),
        field: 'party',
        actual: [result.party],
        targetId: target.id,
        announce: (claimed) => `${target.name} is a ${claimed[0]}`,
      });
      emit('investigation', { target: target.name, party: result.party });
      break;
    }

    case 'special_election':
      game.state = specialElection(game.state, targetIndex);
      tellFallback(`chose ${target.name} as the next President`);
      createEvent(game, 'special_election', {
        presidentId: president.id,
        targetId: target.id,
        targetName: target.name,
        ...flag,
      });
      publishEvent(game, `President ${president.name} called a special election: ${target.name} is the next President.`);
      emit('special_election', { target: target.name });
      break;
  }
}
