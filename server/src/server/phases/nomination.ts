// Nomination: the President picks a Chancellor

import { nominate, getValidChancellorCandidates } from '../../game/engine.js';
import { getNominationPrompt } from '../../ai/prompts.js';
import type { GameRecord } from '../gameRecord.js';
import { createEvent } from '../state.js';
import { askForDecision, recordDialogue, publishEvent, tellPrivately, pickRandom, type LLMClient, type Emit, type TrackCost } from '../conversation.js';

export async function handleNomination(
  game: GameRecord,
  llmClient: LLMClient,
  emit: Emit,
  trackCost: TrackCost
) {
  const president = game.state.players[game.state.presidentIndex];
  const validCandidates = getValidChancellorCandidates(game.state);

  const parsed = await askForDecision(game, llmClient, emit, trackCost, president,
    getNominationPrompt(game.state, validCandidates), 'nomination');
  if (parsed?.dialogue) recordDialogue(game, emit, president, parsed.dialogue);

  // An unknown or ineligible nominee falls back to a random eligible one
  const target = parsed?.action?.type === 'nominate' ? parsed.action.target : undefined;
  const chosen = typeof target === 'string'
    ? game.state.players.findIndex((p) => p.name.toLowerCase() === target.toLowerCase())
    : -1;
  const fallback = !validCandidates.includes(chosen);
  const nomineeIndex = fallback ? pickRandom(validCandidates) : chosen;
  const nominee = game.state.players[nomineeIndex];

  game.state = nominate(game.state, nomineeIndex);
  if (fallback) {
    tellPrivately(game, president.id, `Your response could not be used, so a random eligible Chancellor was nominated for you: you nominated ${nominee.name}.`);
  }
  publishEvent(game, `President ${president.name} nominated ${nominee.name} as Chancellor.`);
  createEvent(game, 'nomination', {
    presidentId: president.id,
    presidentName: president.name,
    nomineeId: nominee.id,
    nomineeName: nominee.name,
    ...(fallback && { fallback: true }),
  });
  emit('action', {
    type: 'nominate',
    actor: president.name,
    target: nominee.name,
  });
}
