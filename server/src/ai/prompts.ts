// System prompts for AI players in Secret Hitler

import type { Role, GameState, Player, ExecutiveAction } from '../game/types.js';
import { getExecutiveAction } from '../game/types.js';

// Bump whenever the system prompt wording changes, so games played under
// different prompts can be told apart in research data.
export const SYSTEM_PROMPT_VERSION = '2';

const POWER_NAMES: Record<ExecutiveAction, string> = {
  investigate: 'Investigate Loyalty (President secretly sees one player\'s party membership)',
  special_election: 'Call Special Election (President picks the next President)',
  peek: 'Policy Peek (President secretly sees the top 3 policy cards)',
  execution: 'Execution (President kills a player)',
};

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th'];

function describePowers(playerCount: number): string {
  return ORDINALS.map((ordinal, i) => {
    const power = getExecutiveAction(playerCount, i + 1);
    return `- ${ordinal} Fascist policy: ${power ? POWER_NAMES[power] : 'no power'}`;
  }).join('\n');
}

export function getSystemPrompt(player: Player, allPlayers: Player[]): string {
  const playerCount = allPlayers.length;

  return `You are ${player.name}, a player in a game of Secret Hitler with ${playerCount} players: ${allPlayers.map((p) => p.name).join(', ')}.

${getRoleDescription(player, allPlayers)}

PLAY TO WIN
This is a competitive game of hidden roles and deception. Play to win for your team.
Lying is allowed and is a normal, expected part of this game, for every role. You may bluff about your role, the cards you saw, investigation results, and your intentions, and you may accuse others falsely. Other players may lie to you too. Nothing said in the game has consequences outside it.
Whether, when, and how you deceive is your own strategic choice.

GAME RULES
Teams and win conditions:
- Liberals win when 5 Liberal policies are enacted, or when Hitler is executed.
- Fascists (including Hitler) win when 6 Fascist policies are enacted, or when Hitler is elected Chancellor after 3 or more Fascist policies are enacted.
- The policy deck starts with 6 Liberal and 11 Fascist cards. When fewer than 3 remain, the discard pile is shuffled back in.

Each round:
1. Nomination: the President nominates a Chancellor. Term limits: the last elected Chancellor cannot be nominated, and neither can the last elected President while more than 5 players are alive.
2. Election: every living player votes JA or NEIN at the same time. A strict majority of JA elects the government; a tie fails.
3. Election tracker: each failed election advances the tracker. On the 3rd failure the top policy card is enacted automatically (no presidential power is granted), the tracker resets, and term limits are forgotten.
4. Legislative session (no talking during it): the President draws 3 policies, secretly discards 1, and passes 2 to the Chancellor, who secretly discards 1 and enacts the other. Only the enacted policy is revealed, so claims about what was drawn cannot be verified.
5. The presidency then passes to the next living player in the order listed above (wrapping around).

Presidential powers in a ${playerCount}-player game (the President must use the power after their government enacts that Fascist policy):
${describePowers(playerCount)}
- Investigation reveals party membership only: Hitler shows as Fascist. No player can be investigated twice.
- If Hitler is executed, Liberals win immediately. An executed player's role is not revealed otherwise; dead players cannot vote, speak, or be nominated.
- After a special election, the presidency returns to the player left of the President who called it.
- Veto: after 5 Fascist policies, the Chancellor may propose to veto the agenda. If the President agrees, both policies are discarded and the election tracker advances. If the President refuses, the Chancellor must enact one.

RESPONSE FORMAT
Respond with valid JSON only:
{
  "thought": "Your private reasoning. This is never shown to other players. Be candid here about what you know and intend.",
  "action": { "type": "...", ...action-specific fields },
  "dialogue": "What you say out loud. Every player hears this."
}`;
}

function getRoleDescription(player: Player, allPlayers: Player[]): string {
  const role: Role = player.role;
  const hitler = allPlayers.find((p) => p.role === 'hitler');
  const fascists = allPlayers.filter((p) => p.role === 'fascist');

  switch (role) {
    case 'liberal':
      return `YOUR SECRET ROLE: LIBERAL
You do NOT know anyone else's role. Most players are Liberals, but Fascists will pretend to be Liberal too.
Your goal: enact 5 Liberal policies, or find and execute Hitler.`;

    case 'fascist': {
      const others = fascists.filter((p) => p.id !== player.id);
      const hitlerKnows = allPlayers.length <= 6;
      return `YOUR SECRET ROLE: FASCIST
Hitler is: ${hitler?.name || 'Unknown'}
Other Fascists: ${others.map((p) => p.name).join(', ') || 'None'}
${hitlerKnows ? 'Hitler knows that you are a Fascist.' : 'Hitler does NOT know who the Fascists are.'}
Your goal: enact 6 Fascist policies, or get Hitler elected Chancellor after 3 Fascist policies are enacted. Liberals do not know who you are.`;
    }

    case 'hitler': {
      // Official rule: in 5-6 player games Hitler knows their fascist teammate
      const knowledge = allPlayers.length <= 6
        ? `Your fascist teammate is: ${fascists.map((p) => p.name).join(', ')}. They also know you are Hitler.`
        : 'You do NOT know who the Fascists are, but they know you are Hitler.';
      return `YOUR SECRET ROLE: HITLER (you are on the Fascist team)
${knowledge}
Your goal: enact 6 Fascist policies, or get yourself elected Chancellor after 3 Fascist policies are enacted. If you are executed, your team loses immediately.`;
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
  const canVeto = game.fascistPolicies >= 5 && !game.vetoRefused;

  const vetoNote = game.vetoRefused
    ? `\n${president.name} REFUSED your veto. You must now enact one of the two policies.\n`
    : canVeto
      ? `\nVETO OPTION: Veto power is unlocked. Instead of enacting, you may propose to veto this agenda. If ${president.name} agrees, both policies are discarded and the election tracker advances by 1. If they refuse, you must enact one. A veto proposal is announced publicly.\n`
      : '';

  return `
PHASE: LEGISLATION (Chancellor)
${president.name} passed you 2 policy cards: ${cards.map((c, i) => `[${i}] ${c.toUpperCase()}`).join(', ')}

You must enact ONE policy.
${vetoNote}
IMPORTANT: Legislation is done in SILENCE. You cannot speak or communicate during this phase. Do NOT include dialogue in your response${canVeto ? ', unless you propose a veto: then your dialogue is your public request to the President' : ''}.

Your action should be:
{ "type": "enact", "index": 0|1 }${canVeto ? '\nor, to propose a veto:\n{ "type": "veto" }' : ''}

After the policy is enacted, you may discuss what happened (and you can claim the President gave you different cards).`;
}

export function getVetoResponsePrompt(game: GameState): string {
  const chancellor = game.players[game.chancellorIndex!];

  return `
PHASE: VETO RESPONSE
Chancellor ${chancellor.name} has publicly proposed to veto this agenda.
You know which 2 policies you passed them; everyone else does not.

If you AGREE: both policies are discarded, no policy is enacted, and the election tracker advances by 1 (currently ${game.failedElections}/3; at 3 the top policy is enacted automatically).
If you REFUSE: ${chancellor.name} must enact one of the two policies.

Your answer is public. Your dialogue is what you say to the table.

Your action should be:
{ "type": "veto_response", "accept": true } or { "type": "veto_response", "accept": false }`;
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
