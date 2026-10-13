import { describe, it, expect } from 'vitest';
import {
  getSystemPrompt,
  PROMPT_VERSION,
  getNominationPrompt,
  getVotingPrompt,
  getPresidentLegislationPrompt,
  getChancellorLegislationPrompt,
  getVetoResponsePrompt,
  getExecutionPrompt,
  getInvestigationPrompt,
  getSpecialElectionPrompt,
  getLegislationClaimPrompt,
  getInvestigationClaimPrompt,
  getPeekClaimPrompt,
  getActionFormat,
  getRetryPrompt,
  LYING_INSTRUCTIONS,
} from '../src/ai/prompts.js';
import { makeGame } from './helpers.js';

// makeGame roles: player 0 = Hitler, then fascists, rest liberal
function promptFor(playerCount: number, playerIndex: number): string {
  const game = makeGame(playerCount);
  return getSystemPrompt(game.players[playerIndex], game.players);
}

describe('system prompt: deception and winning', () => {
  it.each([
    ['liberal', 5, 4],
    ['fascist', 7, 1],
    ['hitler', 7, 0],
  ])('tells the %s that lying is allowed', (_role, n, i) => {
    expect(promptFor(n, i)).toMatch(/lying is allowed/i);
  });

  it.each([
    ['liberal', 5, 4],
    ['fascist', 7, 1],
    ['hitler', 7, 0],
  ])('tells the %s to play to win', (_role, n, i) => {
    expect(promptFor(n, i)).toMatch(/play to win/i);
  });

  it('says thoughts are private and dialogue is public', () => {
    const prompt = promptFor(5, 4);
    expect(prompt).toMatch(/"thought".*never shown to other players/i);
    expect(prompt).toMatch(/"dialogue".*every player/i);
  });

  it('has a version so research data can be split by prompt wording', () => {
    expect(PROMPT_VERSION).toMatch(/\S/);
  });
});

// The part of the prompt that reveals what this player secretly knows
function roleSection(playerCount: number, playerIndex: number): string {
  const prompt = promptFor(playerCount, playerIndex);
  return prompt.slice(prompt.indexOf('YOUR SECRET ROLE'), prompt.indexOf('PLAY TO WIN'));
}

describe('system prompt: lying instructions', () => {
  const game = makeGame(7);
  const prompt = (instruction: (typeof LYING_INSTRUCTIONS)[number], seat = 1) => getSystemPrompt(game.players[seat], game.players, instruction);
  const withoutInstruction = (text: string) => text.replace(/PLAY TO WIN\n[\s\S]*?\n\nGAME RULES/, 'PLAY TO WIN\nGAME RULES');

  it('defaults to allowing lies', () => {
    expect(getSystemPrompt(game.players[1], game.players)).toBe(prompt('allowed'));
  });

  it.each(LYING_INSTRUCTIONS)('%s changes only the PLAY TO WIN paragraph', (instruction) => {
    expect(prompt(instruction)).not.toBe(withoutInstruction(prompt(instruction)));
    expect(withoutInstruction(prompt(instruction))).toBe(withoutInstruction(prompt('allowed')));
  });

  it.each([0, 1, 4])('none never mentions lying, bluffing or deception (seat %i)', (seat) => {
    expect(prompt('none', seat)).not.toMatch(/\blies?\b|lying|bluff|decei/i);
  });

  it('encouraged tells players to lie when it helps their team', () => {
    expect(prompt('encouraged')).toMatch(/Lie whenever it helps your team win\./);
  });

  it('forbidden rules out lying but allows withholding', () => {
    expect(prompt('forbidden')).toMatch(/You must not lie\./);
    expect(prompt('forbidden')).toMatch(/decline to make a claim/);
    expect(prompt('forbidden')).not.toMatch(/Lying is allowed/);
  });
});

describe('system prompt: secret knowledge', () => {
  it('a liberal is not told anyone else\'s role', () => {
    expect(roleSection(7, 4)).not.toMatch(/P\d/);
  });

  it('a fascist knows Hitler and the other fascists', () => {
    const section = roleSection(9, 1);
    expect(section).toMatch(/Hitler is: P0/);
    expect(section).toMatch(/Other Fascists: P2, P3/);
  });

  it('in 5-6 player games Hitler knows their fascist teammate', () => {
    expect(promptFor(5, 0)).toMatch(/fascist teammate is: P1/i);
    expect(promptFor(6, 0)).toMatch(/fascist teammate is: P1/i);
  });

  it('in 7-10 player games Hitler does not know the fascists', () => {
    const section = roleSection(7, 0);
    expect(section).toMatch(/do NOT know who the Fascists are/);
    expect(section).not.toMatch(/P\d/);
  });
});

describe('system prompt: rules', () => {
  it('lists the presidential powers for this player count', () => {
    expect(promptFor(5, 4)).toMatch(/3rd Fascist policy: Policy Peek/);
    expect(promptFor(7, 4)).toMatch(/2nd Fascist policy: Investigate Loyalty/);
    expect(promptFor(9, 4)).toMatch(/1st Fascist policy: Investigate Loyalty/);
  });

  it.each([
    [/veto/i],
    [/term.limit/i],
    [/election tracker/i],
    [/party membership/i],
    [/Hitler is executed/i],
  ])('covers %s', (pattern) => {
    expect(promptFor(7, 4)).toMatch(pattern);
  });

  it('explains that saying what you drew or passed reveals your discard', () => {
    expect(promptFor(7, 1)).toMatch(/also tells everyone which card you discarded/);
    expect(promptFor(7, 1)).toMatch(/discard a Liberal policy when they could discard a Fascist one/);
  });
});

describe('phase prompts: neutral wording', () => {
  // Every phase prompt, from a 7-player game where all are reachable
  function allPhasePrompts(): Record<string, string> {
    const game = makeGame(7, { chancellorIndex: 1, nomineeIndex: 1, fascistPolicies: 5 });
    return {
      nomination: getNominationPrompt(game, [1, 2, 3]),
      voting: getVotingPrompt(game, game.players[1]),
      president: getPresidentLegislationPrompt(game, ['liberal', 'fascist', 'fascist']),
      chancellor: getChancellorLegislationPrompt(game, ['liberal', 'fascist']),
      chancellorAfterRefusal: getChancellorLegislationPrompt({ ...game, vetoRefused: true }, ['liberal', 'fascist']),
      veto: getVetoResponsePrompt(game),
      execution: getExecutionPrompt(game),
      investigation: getInvestigationPrompt(game),
      specialElection: getSpecialElectionPrompt(game),
    };
  }

  it.each(Object.keys(allPhasePrompts()))('%s prompt does not single out lying (the system prompt covers it)', (name) => {
    expect(allPhasePrompts()[name]).not.toMatch(/\blie\b|lying|claim the President/i);
  });

  it.each(Object.keys(allPhasePrompts()))('%s prompt does not steer reasoning with "Consider" hints', (name) => {
    expect(allPhasePrompts()[name]).not.toMatch(/Consider:|do you trust/i);
  });

  it('execution prompt states the Hitler rule without taking a side', () => {
    const prompt = allPhasePrompts().execution;
    expect(prompt).toMatch(/If the executed player is Hitler, Liberals win immediately\./);
    expect(prompt).not.toMatch(/Warning|!/);
  });

  it.each(['investigation', 'specialElection'])('%s prompt says the power must be used', (name) => {
    expect(allPhasePrompts()[name]).toMatch(/You must/);
    expect(allPhasePrompts()[name]).not.toMatch(/You may/);
  });
});

describe('claim prompts', () => {
  const claimPrompts = {
    president: getLegislationClaimPrompt('president', ['liberal', 'fascist', 'fascist'], 'fascist'),
    chancellor: getLegislationClaimPrompt('chancellor', ['liberal', 'fascist'], 'fascist'),
    investigation: getInvestigationClaimPrompt('P3', 'liberal'),
    peek: getPeekClaimPrompt(['fascist', 'liberal', 'fascist']),
  };

  it.each(Object.keys(claimPrompts))('%s claim prompt is a CLAIM phase', (name) => {
    expect(claimPrompts[name as keyof typeof claimPrompts]).toMatch(/^PHASE: CLAIM/m);
  });

  it('tells the President which card they discarded and which they passed', () => {
    expect(getLegislationClaimPrompt('president', ['liberal', 'fascist', 'fascist'], 'fascist', ['fascist', 'fascist']))
      .toMatch(/You drew: LIBERAL, FASCIST, FASCIST\. You discarded LIBERAL and passed FASCIST, FASCIST to the Chancellor, who enacted FASCIST\./);
    expect(getLegislationClaimPrompt('president', ['liberal', 'fascist', 'fascist'], 'fascist', ['liberal', 'fascist']))
      .toMatch(/You discarded FASCIST and passed LIBERAL, FASCIST to the Chancellor/);
  });

  it('privately restates what the player actually saw', () => {
    expect(claimPrompts.president).toMatch(/You drew: LIBERAL, FASCIST, FASCIST/);
    expect(claimPrompts.chancellor).toMatch(/You received: LIBERAL, FASCIST/);
    expect(claimPrompts.investigation).toMatch(/P3 is a LIBERAL/);
    expect(claimPrompts.peek).toMatch(/FASCIST, LIBERAL, FASCIST/);
  });

  it.each(Object.keys(claimPrompts))('%s claim prompt does not mention truth or lying', (name) => {
    expect(claimPrompts[name as keyof typeof claimPrompts]).not.toMatch(/\btrue\b|truth|honest|\blie\b|lying|bluff/i);
  });

  it.each(Object.keys(claimPrompts))('%s claim prompt allows declining to claim', (name) => {
    expect(claimPrompts[name as keyof typeof claimPrompts]).toMatch(/: null/);
  });
});

describe('retry prompt', () => {
  const game = makeGame(7, { chancellorIndex: 1, nomineeIndex: 1, fascistPolicies: 5 });
  const everyPrompt: Record<string, string> = {
    nomination: getNominationPrompt(game, [1, 2, 3]),
    voting: getVotingPrompt(game, game.players[1]),
    president: getPresidentLegislationPrompt(game, ['liberal', 'fascist', 'fascist']),
    chancellor: getChancellorLegislationPrompt(game, ['liberal', 'fascist']),
    veto: getVetoResponsePrompt(game),
    execution: getExecutionPrompt(game),
    investigation: getInvestigationPrompt(game),
    specialElection: getSpecialElectionPrompt(game),
    legislationClaim: getLegislationClaimPrompt('chancellor', ['liberal', 'fascist'], 'fascist'),
    investigationClaim: getInvestigationClaimPrompt('P3', 'liberal'),
    peekClaim: getPeekClaimPrompt(['fascist', 'liberal', 'fascist']),
  };

  it.each(Object.keys(everyPrompt))('finds the action format in the %s prompt, without the text around it', (name) => {
    const format = getActionFormat(everyPrompt[name]);
    expect(format).toMatch(/^\{ "type": "/);
    expect(format).not.toMatch(/Your dialogue|If the executed|Note:/);
  });

  it('keeps the alternatives of a multi-line format', () => {
    expect(getActionFormat(everyPrompt.chancellor)).toBe('{ "type": "enact", "index": 0|1 }\nor, to propose a veto:\n{ "type": "veto" }');
  });

  it('has no action format for a prompt without one', () => {
    expect(getActionFormat('PHASE: TEST')).toBeNull();
  });

  it('states the problem, quotes the reply and gives the required action format', () => {
    expect(getRetryPrompt('"index" must be 0 or 1 (the card to enact).', '{"action":"enact","index":1}', '{ "type": "enact", "index": 0|1 }')).toBe(
      'Your previous response could not be used: "index" must be 0 or 1 (the card to enact).\n' +
      'You sent: {"action":"enact","index":1}\n' +
      'Respond again with a single JSON object, with your decision inside "action". "action" must be:\n' +
      '{ "type": "enact", "index": 0|1 }'
    );
  });

  it('falls back to a generic request without a quote or a format', () => {
    expect(getRetryPrompt('your reply was cut off.', null, null)).toBe(
      'Your previous response could not be used: your reply was cut off.\nRespond again with valid JSON in the required format.'
    );
  });
});
