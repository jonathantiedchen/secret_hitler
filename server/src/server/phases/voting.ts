// Voting: every living player votes on the proposed government

import { castVote, tallyVotes, resolveVote } from '../../game/engine.js';
import type { Vote } from '../../game/types.js';
import type { ChatMessage } from '../../ai/openrouter.js';
import { getVotingPrompt } from '../../ai/prompts.js';
import type { GameRecord, PublicEvent } from '../gameRecord.js';
import { createEvent } from '../state.js';
import { askPlayer, publishEvent, formatTracks, type LLMClient, type Emit, type TrackCost } from '../conversation.js';

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
    const votingPrompt = getVotingPrompt(game.state, nominee);

    createEvent(game, 'thinking', { playerId: player.id, playerName: player.name });
    emit('thinking', { playerId: player.id, playerName: player.name });

    let response;
    try {
      let prompt: ChatMessage[];
      ({ response, prompt } = await askPlayer(game, llmClient, player, votingPrompt));

      // Track cost
      trackCost(response.cost);

      // Emit debug info
      emit('debug', {
        playerId: player.id,
        playerName: player.name,
        model: player.model,
        phase: 'voting',
        prompt,
        response: response.content,
      });
    } catch (apiError) {
      console.error(`API error for ${player.name} (${player.model}):`, apiError);
      // Fallback on API error: random vote
      const vote: Vote = Math.random() > 0.5 ? 'ja' : 'nein';
      game.state = castVote(game.state, player.id, vote);
      emit('vote', { playerId: player.id, playerName: player.name, vote });
      continue;
    }

    try {
      const parsed = JSON.parse(response.content);

      if (parsed.thought) {
        createEvent(game, 'thought', {
          playerId: player.id,
          playerName: player.name,
          content: parsed.thought,
        });
        if (game.settings.showThoughts) {
          emit('thought', {
            playerId: player.id,
            playerName: player.name,
            content: parsed.thought,
          });
        }
      }

      if (parsed.dialogue) {
        createEvent(game, 'dialogue', {
          playerId: player.id,
          playerName: player.name,
          content: parsed.dialogue,
        });
        voteDialogue.push({ content: `${player.name}: "${parsed.dialogue}"`, authorId: player.id });
        emit('dialogue', {
          playerId: player.id,
          playerName: player.name,
          content: parsed.dialogue,
        });
      }

      if (parsed.action?.vote) {
        const vote: Vote = parsed.action.vote === 'ja' ? 'ja' : 'nein';
        game.state = castVote(game.state, player.id, vote);
        createEvent(game, 'vote', { playerId: player.id, playerName: player.name, vote });
        emit('vote', { playerId: player.id, playerName: player.name, vote });
      }
    } catch (e) {
      // Fallback: random vote
      const vote: Vote = Math.random() > 0.5 ? 'ja' : 'nein';
      game.state = castVote(game.state, player.id, vote);
      createEvent(game, 'vote', { playerId: player.id, playerName: player.name, vote, fallback: true });
      emit('vote', { playerId: player.id, playerName: player.name, vote });
    }
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
