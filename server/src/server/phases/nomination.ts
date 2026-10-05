// Nomination: the President picks a Chancellor

import { nominate, getValidChancellorCandidates } from '../../game/engine.js';
import { getNominationPrompt } from '../../ai/prompts.js';
import type { GameRecord } from '../gameRecord.js';
import { createEvent } from '../state.js';
import { askForDecision, recordDialogue, publishEvent, playerIndexByName, type LLMClient, type Emit, type TrackCost } from '../conversation.js';

export async function handleNomination(
  game: GameRecord,
  llmClient: LLMClient,
  emit: Emit,
  trackCost: TrackCost
) {
  const president = game.state.players[game.state.presidentIndex];
  const validCandidates = getValidChancellorCandidates(game.state);

  const names = validCandidates.map((i) => game.state.players[i].name).join(', ');
  const { response, value: nomineeIndex } = await askForDecision(game, llmClient, emit, trackCost, president,
    getNominationPrompt(game.state, validCandidates), 'nomination', (r) => {
      const index = playerIndexByName(game, r.action?.target);
      return validCandidates.includes(index)
        ? { ok: true, value: index }
        : { ok: false, error: `"${String(r.action?.target)}" cannot be nominated. Valid candidates: ${names}.` };
    });
  if (response.dialogue) recordDialogue(game, emit, president, response.dialogue);

  const nominee = game.state.players[nomineeIndex];
  game.state = nominate(game.state, nomineeIndex);
  publishEvent(game, `President ${president.name} nominated ${nominee.name} as Chancellor.`);
  createEvent(game, 'nomination', {
    presidentId: president.id,
    presidentName: president.name,
    nomineeId: nominee.id,
    nomineeName: nominee.name,
  });
  emit('action', {
    type: 'nominate',
    actor: president.name,
    target: nominee.name,
  });
}
