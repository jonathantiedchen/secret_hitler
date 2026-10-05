// Public claims about privately seen cards and investigation results

import type { Player, PolicyCard } from '../../game/types.js';
import { getLegislationClaimPrompt } from '../../ai/prompts.js';
import { evaluateClaim } from '../../game/claims.js';
import type { GameRecord } from '../gameRecord.js';
import { createEvent } from '../state.js';
import { askForDecision, recordDialogue, publishEvent, type LLMClient, type Emit, type TrackCost, type Validation } from '../conversation.js';

export type ClaimType = 'president_legislation' | 'chancellor_legislation' | 'investigation' | 'peek';

// Ask a player to publicly claim what they privately saw, and log the claim next to the truth.
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
  // A claim names cards / a party, or null to decline
  const count = claim.actual.length;
  const isCard = (x: unknown): x is string => typeof x === 'string' && ['LIBERAL', 'FASCIST'].includes(x.toUpperCase());
  const { response, value: claimed } = await askForDecision(game, llmClient, emit, trackCost, player, claim.prompt, `claim_${claim.claimType}`,
    (r): Validation<string[] | null> => {
      const raw = r.action?.[claim.field];
      if (raw === null || raw === undefined) return { ok: true, value: null };
      if (claim.field === 'party') {
        return isCard(raw) ? { ok: true, value: [raw.toUpperCase()] } : { ok: false, error: '"party" must be "LIBERAL", "FASCIST" or null.' };
      }
      return Array.isArray(raw) && raw.length === count && raw.every(isCard)
        ? { ok: true, value: raw.map((c) => c.toUpperCase()) }
        : { ok: false, error: `"cards" must be null or a list of exactly ${count} cards, each "LIBERAL" or "FASCIST".` };
    });
  if (response.dialogue) recordDialogue(game, emit, player, response.dialogue);

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
