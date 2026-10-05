// Voting: every living player votes on the proposed government

import { castVote, tallyVotes, resolveVote } from '../../game/engine.js';
import type { Vote } from '../../game/types.js';
import { getVotingPrompt } from '../../ai/prompts.js';
import type { GameRecord, PublicEvent } from '../gameRecord.js';
import { createEvent } from '../state.js';
import { askForDecision, recordDialogue, publishEvent, formatTracks, type LLMClient, type Emit, type TrackCost } from '../conversation.js';

// ja/yes or nein/no in any case; anything else is not a usable vote
function parseVote(raw: unknown): Vote | null {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (v === 'ja' || v === 'yes') return 'ja';
  if (v === 'nein' || v === 'no') return 'nein';
  return null;
}

export async function handleVoting(
  game: GameRecord,
  llmClient: LLMClient,
  emit: Emit,
  trackCost: TrackCost
) {
  const nominee = game.state.players[game.state.nomineeIndex!];
  const alivePlayers = game.state.players.filter((p) => p.isAlive);

  // Votes are simultaneous: hold voters' public remarks until everyone has voted
  const voteDialogue: PublicEvent[] = [];

  // Each alive player votes
  for (const player of alivePlayers) {
    const { response, value: vote } = await askForDecision(game, llmClient, emit, trackCost, player,
      getVotingPrompt(game.state, nominee), 'voting', (r) => {
        const v = parseVote(r.action?.vote);
        return v ? { ok: true, value: v } : { ok: false, error: '"vote" must be "ja" or "nein".' };
      });
    if (response.dialogue) recordDialogue(game, emit, player, response.dialogue, voteDialogue);

    game.state = castVote(game.state, player.id, vote);
    createEvent(game, 'vote', { playerId: player.id, playerName: player.name, vote });
    emit('vote', { playerId: player.id, playerName: player.name, vote });
  }

  // Tally votes
  const result = tallyVotes(game.state);
  const chancellorNominee = game.state.players[game.state.nomineeIndex!];

  game.publicEvents.push(...voteDialogue);
  const perPlayerVotes = alivePlayers
    .map((p) => `${p.name} ${(game.state.votes.get(p.id) ?? '?').toString().toUpperCase()}`)
    .join(', ');
  publishEvent(
    game,
    `Vote on ${game.state.players[game.state.presidentIndex].name} / ${chancellorNominee.name}: ${perPlayerVotes}. Result: ${result.passed ? 'PASSED' : 'FAILED'}.`
  );

  createEvent(game, 'vote_result', {
    passed: result.passed,
    jaCount: result.jaCount,
    neinCount: result.neinCount,
    presidentName: game.state.players[game.state.presidentIndex].name,
    nomineeName: chancellorNominee.name,
  });
  emit('vote_result', result);

  // Log Hitler election check
  if (result.passed && chancellorNominee.role === 'hitler') {
    console.log(`⚠️ Hitler (${chancellorNominee.name}) elected as Chancellor! Fascist policies: ${game.state.fascistPolicies}`);
    if (game.state.fascistPolicies >= 3) {
      console.log('🔴 GAME OVER: Hitler elected after 3+ fascist policies!');
    }
  }

  const before = game.state;
  game.state = resolveVote(game.state);

  if (!result.passed) {
    if (game.state.liberalPolicies !== before.liberalPolicies || game.state.fascistPolicies !== before.fascistPolicies) {
      const policy = game.state.liberalPolicies !== before.liberalPolicies ? 'LIBERAL' : 'FASCIST';
      publishEvent(game, `Election failed (tracker 3/3). Chaos: a ${policy} policy was auto-enacted from the top of the deck. ${formatTracks(game.state)}`);
    } else {
      publishEvent(game, `Election failed (tracker ${game.state.failedElections}/3).`);
    }
  }

  // Verify game state after vote resolution
  if (game.state.phase === 'game_over') {
    console.log(`🏁 Game ended: ${game.state.winCondition}`);
  }
}
