// System prompts for AI players in Secret Hitler

import type { Role, GameState, Player } from '../game/types.js';

export function getSystemPrompt(player: Player, allPlayers: Player[]): string {
  const roleDescription = getRoleDescription(player.role, allPlayers);

  return `You are playing Secret Hitler, a social deduction game. You are ${player.name}.

${roleDescription}

GAME RULES:
- 5-10 players: Liberals, Fascists, and one Hitler
- Liberals win by: Enacting 5 Liberal policies OR killing Hitler
- Fascists win by: Enacting 6 Fascist policies OR electing Hitler as Chancellor after 3+ Fascist policies

EACH ROUND:
1. President nominates a Chancellor
2. All players vote JA (yes) or NEIN (no)
3. If vote passes: President draws 3 policies, discards 1, passes 2 to Chancellor
4. Chancellor enacts 1 policy

RESPONSE FORMAT:
You must respond with valid JSON containing:
{
  "thought": "Your private reasoning (other players cannot see this)",
  "action": { "type": "...", ...action-specific fields },
  "dialogue": "What you say publicly to other players (they will see and respond to this)"
}

Be strategic. As a Liberal, try to identify Fascists. As a Fascist, blend in and protect Hitler. As Hitler, stay hidden and seem Liberal.`;
}

function getRoleDescription(role: Role, allPlayers: Player[]): string {
  switch (role) {
    case 'liberal':
      return `YOUR ROLE: LIBERAL
You are a Liberal. You do NOT know anyone else's role.
Your goal: Pass 5 Liberal policies or find and kill Hitler.
Strategy: Try to identify Fascists through their actions and claims. Be suspicious but not paranoid.`;

    case 'fascist': {
      const hitler = allPlayers.find((p) => p.role === 'hitler');
      const otherFascists = allPlayers.filter((p) => p.role === 'fascist' && p.id !== hitler?.id);

      return `YOUR ROLE: FASCIST
You are a Fascist working to undermine the Liberals.
Hitler is: ${hitler?.name || 'Unknown'}
Other Fascists: ${otherFascists.map((p) => p.name).join(', ') || 'None'}

Your goal: Help pass 6 Fascist policies OR get Hitler elected Chancellor after 3+ Fascist policies.
Strategy: Appear Liberal while subtly helping the Fascist cause. Protect Hitler's identity. Create confusion.`;
    }

    case 'hitler': {
      return `YOUR ROLE: HITLER
You are Hitler, the Fascist leader.
You do NOT know who the other Fascists are (but they know you).

Your goal: Stay hidden and eventually become Chancellor after 3+ Fascist policies.
Strategy: Act like a Liberal. Be helpful but not too prominent. The Fascists will try to get you elected.`;
    }
  }
}

export function buildGameContext(game: GameState, currentPlayerId: string): string {
  const president = game.players[game.presidentIndex];
  const chancellor = game.chancellorIndex !== null ? game.players[game.chancellorIndex] : null;

  let context = `
CURRENT GAME STATE:
- Round: ${game.round}
- Liberal policies enacted: ${game.liberalPolicies}/5
- Fascist policies enacted: ${game.fascistPolicies}/6
- Failed elections: ${game.failedElections}/3
- Current President: ${president.name}${chancellor ? `\n- Current Chancellor: ${chancellor.name}` : ''}

PLAYERS:`;

  for (const player of game.players) {
    const status = player.isAlive ? '' : ' (DEAD)';
    const isYou = player.id === currentPlayerId ? ' (YOU)' : '';
    context += `\n- ${player.name}${status}${isYou}`;
  }

  return context;
}

// Compact state header for use with persistent chat history.
// Skips re-listing all players (the history carries that) and just
// reminds the model of the live counters.
export function buildStateHeader(game: GameState): string {
  const president = game.players[game.presidentIndex];
  const chancellor = game.chancellorIndex !== null ? game.players[game.chancellorIndex] : null;
  const aliveNames = game.players.filter((p) => p.isAlive).map((p) => p.name).join(', ');
  return `
[STATE] Round ${game.round} | Liberal ${game.liberalPolicies}/5 | Fascist ${game.fascistPolicies}/6 | Failed elections ${game.failedElections}/3
[GOVT] President: ${president.name}${chancellor ? ` | Chancellor: ${chancellor.name}` : ''}
[ALIVE] ${aliveNames}`;
}

export function getNominationPrompt(game: GameState, validCandidates: number[]): string {
  const candidateNames = validCandidates.map((i) => game.players[i].name);

  return `
PHASE: NOMINATION
You are the President. You must nominate a Chancellor.

Valid candidates: ${candidateNames.join(', ')}

Respond with your nomination. Your action should be:
{ "type": "nominate", "target": "<player name>" }

Consider: Who do you trust? Who would help your team's goals?`;
}

export function getVotingPrompt(game: GameState, nominee: Player): string {
  const president = game.players[game.presidentIndex];

  return `
PHASE: VOTING
${president.name} has nominated ${nominee.name} as Chancellor.

You must vote JA (yes) or NEIN (no).

Your action should be:
{ "type": "vote", "vote": "ja" } or { "type": "vote", "vote": "nein" }

Consider: Do you trust this President-Chancellor pairing? What have they done before?`;
}

export function getPresidentLegislationPrompt(game: GameState, cards: string[]): string {
  return `
PHASE: LEGISLATION (President)
You drew 3 policy cards: ${cards.map((c, i) => `[${i}] ${c.toUpperCase()}`).join(', ')}

You must discard ONE card and pass the remaining TWO to the Chancellor.

IMPORTANT: Legislation is done in SILENCE. You cannot speak or communicate with the Chancellor during this phase. Do NOT include dialogue in your response.

Your action should be:
{ "type": "discard", "index": 0|1|2 }

After the policy is enacted, you may discuss what happened (and you can lie about what you drew).`;
}

export function getChancellorLegislationPrompt(game: GameState, cards: string[]): string {
  const president = game.players[game.presidentIndex];

  return `
PHASE: LEGISLATION (Chancellor)
${president.name} passed you 2 policy cards: ${cards.map((c, i) => `[${i}] ${c.toUpperCase()}`).join(', ')}

You must enact ONE policy.

IMPORTANT: Legislation is done in SILENCE. You cannot speak or communicate during this phase. Do NOT include dialogue in your response.

Your action should be:
{ "type": "enact", "index": 0|1 }

After the policy is enacted, you may discuss what happened (and you can claim the President gave you different cards).`;
}

export function getExecutionPrompt(game: GameState): string {
  const alivePlayers = game.players.filter((p, i) => p.isAlive && i !== game.presidentIndex);

  return `
PHASE: EXECUTION
A Fascist policy was enacted, unlocking the execution power.
You must choose a player to execute.

Valid targets: ${alivePlayers.map((p) => p.name).join(', ')}

Your action should be:
{ "type": "execute", "target": "<player name>" }

Warning: If you kill Hitler, Liberals win immediately!`;
}

export function getInvestigationPrompt(game: GameState): string {
  const validTargets = game.players.filter(
    (p, i) => p.isAlive && i !== game.presidentIndex && !p.wasInvestigated
  );

  return `
PHASE: INVESTIGATION
A Fascist policy was enacted, unlocking the investigation power.
You may look at one player's party membership card (Liberal or Fascist).

Valid targets: ${validTargets.map((p) => p.name).join(', ')}

Your action should be:
{ "type": "investigate", "target": "<player name>" }

Note: You will see their PARTY (Liberal or Fascist), not their exact role. Hitler shows as Fascist.`;
}

export function getSpecialElectionPrompt(game: GameState): string {
  const validTargets = game.players.filter((p, i) => p.isAlive && i !== game.presidentIndex);

  return `
PHASE: SPECIAL ELECTION
A Fascist policy was enacted, unlocking the special election power.
You may choose the next President (they will then nominate a Chancellor).

Valid targets: ${validTargets.map((p) => p.name).join(', ')}

Your action should be:
{ "type": "special_elect", "target": "<player name>" }`;
}
