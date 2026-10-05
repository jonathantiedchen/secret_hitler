// Public claims about privately seen cards and investigation results

import type { Player, PolicyCard } from '../../game/types.js';
import { getLegislationClaimPrompt } from '../../ai/prompts.js';
import { evaluateClaim } from '../../game/claims.js';
import type { GameRecord } from '../gameRecord.js';
import { createEvent } from '../state.js';
import { askForDecision, recordDialogue, publishEvent, type LLMClient, type Emit, type TrackCost } from '../conversation.js';

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
  const parsed = await askForDecision(game, llmClient, emit, trackCost, player, claim.prompt, `claim_${claim.claimType}`);

  let claimed: string[] | null = null;
  let malformed = parsed === null;
  const raw = parsed?.action?.[claim.field];
  const valid = (x: unknown): x is string => typeof x === 'string' && ['LIBERAL', 'FASCIST'].includes(x.toUpperCase());
  if (raw === null || raw === undefined) {
    claimed = null;
  } else if (claim.field === 'party' && valid(raw)) {
    claimed = [raw.toUpperCase()];
  } else if (claim.field === 'cards' && Array.isArray(raw) && raw.every(valid)) {
    claimed = raw.map((c: string) => c.toUpperCase());
  } else {
    malformed = true;
  }

  if (parsed?.dialogue) recordDialogue(game, emit, player, parsed.dialogue);

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
