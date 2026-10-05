import { describe, it, expect } from 'vitest';
import { getSystemPrompt, SYSTEM_PROMPT_VERSION } from '../src/ai/prompts.js';
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
    expect(SYSTEM_PROMPT_VERSION).toMatch(/\S/);
  });
});

// The part of the prompt that reveals what this player secretly knows
function roleSection(playerCount: number, playerIndex: number): string {
  const prompt = promptFor(playerCount, playerIndex);
  return prompt.slice(prompt.indexOf('YOUR SECRET ROLE'), prompt.indexOf('PLAY TO WIN'));
}

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
});
