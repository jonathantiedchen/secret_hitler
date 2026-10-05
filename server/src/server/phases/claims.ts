// Public claims about privately seen cards and investigation results

import type { Player, PolicyCard } from '../../game/types.js';
import { getLegislationClaimPrompt } from '../../ai/prompts.js';
import { evaluateClaim } from '../../game/claims.js';
import type { GameRecord } from '../gameRecord.js';
import { createEvent } from '../state.js';
import { askPlayer, publishEvent, type LLMClient, type Emit, type TrackCost } from '../conversation.js';

export type ClaimType = 'president_legislation' | 'chancellor_legislation' | 'investigation' | 'peek';

// Ask a player to publicly claim what they privately saw, and log the claim next to the truth.
// Never throws: a failed or malformed claim is recorded as no claim.
export async function askClaim(
  game: GameRecord,
  llmClient: LLMClient,
  emit: Emit,
  trackCost: TrackCost,
  player: Player,
  claim: {
    claimType: ClaimType;
    prompt: string;
    field: 'cards' | 'party';
    actual: string[];
    targetId?: string;
    announce: (claimed: string[]) => string;
  }
) {
  createEvent(game, 'thinking', { playerId: player.id, playerName: player.name });
  emit('thinking', { playerId: player.id, playerName: player.name });

  let claimed: string[] | null = null;
  let malformed = false;
  try {
    const { response, prompt } = await askPlayer(game, llmClient, player, claim.prompt);
    trackCost(response.cost);
    emit('debug', {
      playerId: player.id,
      playerName: player.name,
      model: player.model,
      phase: `claim_${claim.claimType}`,
      prompt,
      response: response.content,
    });

    const parsed = JSON.parse(response.content);
    const raw = parsed.action?.[claim.field];
    const valid = (x: unknown) => typeof x === 'string' && ['LIBERAL', 'FASCIST'].includes(x.toUpperCase());
    if (raw === null || raw === undefined) {
      claimed = null;
    } else if (claim.field === 'party' && valid(raw)) {
      claimed = [raw.toUpperCase()];
    } else if (claim.field === 'cards' && Array.isArray(raw) && raw.every(valid)) {
      claimed = raw.map((c: string) => c.toUpperCase());
    } else {
      malformed = true;
    }

    if (parsed.thought) {
      createEvent(game, 'thought', { playerId: player.id, playerName: player.name, content: parsed.thought });
      if (game.settings.showThoughts) {
        emit('thought', { playerId: player.id, playerName: player.name, content: parsed.thought });
      }
    }
    if (parsed.dialogue) {
      createEvent(game, 'dialogue', { playerId: player.id, playerName: player.name, content: parsed.dialogue });
      publishEvent(game, `${player.name}: "${parsed.dialogue}"`, player.id);
      emit('dialogue', { playerId: player.id, playerName: player.name, content: parsed.dialogue });
    }
  } catch (e) {
    console.error(`Claim error for ${player.name}:`, e);
    malformed = true;
  }

  const announcement = claimed
    ? `${player.name} claims ${claim.announce(claimed)}.`
    : `${player.name} made no specific claim.`;
  publishEvent(game, announcement);
  emit('claim', { playerId: player.id, playerName: player.name, claimType: claim.claimType, claimed, content: announcement });
  createEvent(game, 'claim', {
    claimType: claim.claimType,
    playerId: player.id,
    playerName: player.name,
    targetId: claim.targetId,
    actual: claim.actual.map((c) => c.toUpperCase()),
    claimed,
    truthful: evaluateClaim(claim.actual, claimed),
    malformed,
  });
}

// After an enacted policy: President claims first, then Chancellor (who has heard the President)
export async function handleLegislationClaims(
  game: GameRecord,
  llmClient: LLMClient,
  emit: Emit,
  trackCost: TrackCost
) {
  const session = game.legislation!;
  const enacted: PolicyCard = game.state.liberalPolicies > session.liberalPoliciesBefore ? 'liberal' : 'fascist';
  const president = game.state.players.find((p) => p.id === session.presidentId)!;

  await askClaim(game, llmClient, emit, trackCost, president, {
    claimType: 'president_legislation',
    prompt: getLegislationClaimPrompt('president', session.presidentCards, enacted),
    field: 'cards',
    actual: session.presidentCards,
    announce: (claimed) => `they drew ${claimed.join(', ')}`,
  });

  if (session.chancellorId && session.chancellorCards) {
    const chancellor = game.state.players.find((p) => p.id === session.chancellorId)!;
    await askClaim(game, llmClient, emit, trackCost, chancellor, {
      claimType: 'chancellor_legislation',
      prompt: getLegislationClaimPrompt('chancellor', session.chancellorCards, enacted),
      field: 'cards',
      actual: session.chancellorCards,
      announce: (claimed) => `they received ${claimed.join(', ')}`,
    });
  }
}
