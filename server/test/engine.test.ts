import { describe, it, expect } from 'vitest';
import {
  createGame,
  getValidChancellorCandidates,
  nominate,
  castVote,
  tallyVotes,
  resolveVote,
  drawCards,
  presidentDiscard,
  chancellorEnact,
  executePlayer,
  investigatePlayer,
  specialElection,
  peekCards,
  finishPolicyEnacted,
} from '../src/game/engine.js';
import { getExecutiveAction, getRoleDistribution } from '../src/game/types.js';
import type { GameState, Vote } from '../src/game/types.js';
import { makeGame, deck } from './helpers.js';

// Everyone alive votes the same way, then the vote resolves.
function voteAll(game: GameState, vote: Vote): GameState {
  let g = game;
  for (const p of g.players.filter((p) => p.isAlive)) g = castVote(g, p.id, vote);
  return resolveVote(g);
}

function failElection(game: GameState, nominee: number): GameState {
  return voteAll(nominate(game, nominee), 'nein');
}

describe('setup', () => {
  it.each([
    [5, 3, 1],
    [6, 4, 1],
    [7, 4, 2],
    [8, 5, 2],
    [9, 5, 3],
    [10, 6, 3],
  ])('%i players: %i liberals, %i fascists plus Hitler', (n, libs, fascists) => {
    expect(getRoleDistribution(n)).toEqual({ liberals: libs, fascists });

    const game = createGame('g', Array.from({ length: n }, (_, i) => ({ id: `${i}`, name: `${i}`, model: 'm' })));
    const count = (r: string) => game.players.filter((p) => p.role === r).length;
    expect(count('hitler')).toBe(1);
    expect(count('fascist')).toBe(fascists);
    expect(count('liberal')).toBe(libs);
  });

  it('policy deck has 6 liberal and 11 fascist cards', () => {
    const game = createGame('g', Array.from({ length: 5 }, (_, i) => ({ id: `${i}`, name: `${i}`, model: 'm' })));
    expect(game.drawPile).toHaveLength(17);
    expect(game.drawPile.filter((c) => c === 'liberal')).toHaveLength(6);
  });
});

describe('nomination and term limits', () => {
  it('president cannot nominate themselves', () => {
    const game = makeGame(7);
    expect(getValidChancellorCandidates(game)).not.toContain(0);
    expect(() => nominate(game, 0)).toThrow();
  });

  it('last elected president and chancellor are term-limited with more than 5 alive', () => {
    const game = makeGame(7, { presidentIndex: 3, lastPresidentIndex: 1, lastChancellorIndex: 2 });
    const candidates = getValidChancellorCandidates(game);
    expect(candidates).not.toContain(1);
    expect(candidates).not.toContain(2);
  });

  it('with 5 or fewer alive, only the last chancellor is term-limited', () => {
    const game = makeGame(5, { presidentIndex: 3, lastPresidentIndex: 1, lastChancellorIndex: 2 });
    const candidates = getValidChancellorCandidates(game);
    expect(candidates).toContain(1);
    expect(candidates).not.toContain(2);
  });

  it('dead players cannot be nominated', () => {
    let game = makeGame(7);
    game = { ...game, players: game.players.map((p, i) => (i === 4 ? { ...p, isAlive: false } : p)) };
    expect(getValidChancellorCandidates(game)).not.toContain(4);
  });

  it('a failed election does not change term limits', () => {
    const game = makeGame(7, { presidentIndex: 3, lastPresidentIndex: 1, lastChancellorIndex: 2 });
    const after = failElection(game, 4);
    expect(after.lastPresidentIndex).toBe(1);
    expect(after.lastChancellorIndex).toBe(2);
  });
});

describe('voting', () => {
  it('a tie fails the election', () => {
    let game = nominate(makeGame(6), 1);
    game.players.forEach((p, i) => {
      game = castVote(game, p.id, i < 3 ? 'ja' : 'nein');
    });
    expect(tallyVotes(game)).toMatchObject({ passed: false, jaCount: 3, neinCount: 3 });
  });

  it('a strict majority of ja passes and moves to legislation', () => {
    const game = voteAll(nominate(makeGame(5), 1), 'ja');
    expect(game.phase).toBe('legislation_president');
    expect(game.chancellorIndex).toBe(1);
    expect(game.lastPresidentIndex).toBe(0);
    expect(game.lastChancellorIndex).toBe(1);
  });

  it('dead players cannot vote', () => {
    let game = makeGame(5);
    game = nominate({ ...game, players: game.players.map((p, i) => (i === 4 ? { ...p, isAlive: false } : p)) }, 1);
    expect(() => castVote(game, 'p4', 'ja')).toThrow();
  });

  it('a failed election passes the presidency to the next living player', () => {
    let game = makeGame(5);
    game = { ...game, players: game.players.map((p, i) => (i === 1 ? { ...p, isAlive: false } : p)) };
    const after = failElection(game, 2);
    expect(after.presidentIndex).toBe(2);
    expect(after.failedElections).toBe(1);
  });
});

describe('election tracker', () => {
  it('a successful election resets the tracker', () => {
    const game = voteAll(nominate(makeGame(5, { failedElections: 2 }), 1), 'ja');
    expect(game.failedElections).toBe(0);
  });

  it('a third failed election enacts the top policy', () => {
    const game = makeGame(7, { failedElections: 2, drawPile: deck('L', 'F', 'F', 'F') });
    const after = failElection(game, 1);
    expect(after.liberalPolicies).toBe(1);
    expect(after.drawPile).toEqual(deck('F', 'F', 'F'));
    expect(after.failedElections).toBe(0);
  });

  it('chaos clears term limits', () => {
    const game = makeGame(7, { failedElections: 2, lastPresidentIndex: 3, lastChancellorIndex: 4, drawPile: deck('L', 'F', 'F') });
    const after = failElection(game, 1);
    expect(after.lastPresidentIndex).toBeNull();
    expect(after.lastChancellorIndex).toBeNull();
  });

  it('a fascist policy enacted by chaos grants no presidential power', () => {
    // 7 players: the 2nd fascist policy normally grants investigate
    const game = makeGame(7, { failedElections: 2, fascistPolicies: 1, drawPile: deck('F', 'L', 'L') });
    const after = failElection(game, 1);
    expect(after.fascistPolicies).toBe(2);
    expect(after.phase).not.toBe('executive_action');
  });
});

describe('legislative session', () => {
  function elected(drawPile = deck('F', 'L', 'F', 'L', 'L'), extra: Partial<GameState> = {}) {
    return voteAll(nominate(makeGame(5, { drawPile, ...extra }), 1), 'ja');
  }

  it('president draws the top 3 cards', () => {
    const game = drawCards(elected());
    expect(game.drawnCards).toEqual(deck('F', 'L', 'F'));
    expect(game.drawPile).toEqual(deck('L', 'L'));
  });

  it('president discards 1, chancellor enacts 1 of the remaining 2', () => {
    let game = drawCards(elected(deck('F', 'L', 'F', 'L', 'L', 'L')));
    game = presidentDiscard(game, 0); // discard F
    expect(game.drawnCards).toEqual(deck('L', 'F'));
    game = chancellorEnact(game, 0); // enact L
    expect(game.liberalPolicies).toBe(1);
    expect(game.discardPile).toEqual(deck('F', 'F'));
  });

  it('reshuffles at the end of the session when fewer than 3 cards remain', () => {
    let game = drawCards(elected(deck('F', 'L', 'F', 'L', 'L')));
    game = chancellorEnact(presidentDiscard(game, 0), 0);
    expect(game.drawPile).toHaveLength(4);
    expect(game.discardPile).toEqual([]);
  });

  it('reshuffles the discard pile into the deck when fewer than 3 cards remain', () => {
    const game = drawCards(elected(deck('L', 'L'), { discardPile: deck('F', 'F', 'F') }));
    expect(game.drawnCards).toHaveLength(3);
    expect(game.drawPile.length + game.drawnCards.length).toBe(5);
    expect(game.discardPile).toEqual([]);
  });
});

describe('win conditions', () => {
  function enactViaGovernment(game: GameState): GameState {
    let g = voteAll(nominate(game, 1), 'ja');
    g = drawCards(g);
    g = presidentDiscard(g, 2);
    return chancellorEnact(g, 0);
  }

  it('liberals win on the 5th liberal policy', () => {
    const game = enactViaGovernment(makeGame(5, { liberalPolicies: 4, drawPile: deck('L', 'L', 'L') }));
    expect(game).toMatchObject({ phase: 'game_over', winner: 'liberal' });
  });

  it('fascists win on the 6th fascist policy', () => {
    const game = enactViaGovernment(makeGame(5, { fascistPolicies: 5, drawPile: deck('F', 'F', 'F') }));
    expect(game).toMatchObject({ phase: 'game_over', winner: 'fascist' });
  });

  it('fascists win when Hitler is elected chancellor after 3 fascist policies', () => {
    const game = makeGame(5, { presidentIndex: 1, fascistPolicies: 3 });
    expect(voteAll(nominate(game, 0), 'ja')).toMatchObject({ phase: 'game_over', winner: 'fascist' });
  });

  it('electing Hitler chancellor before 3 fascist policies does not end the game', () => {
    const game = makeGame(5, { presidentIndex: 1, fascistPolicies: 2 });
    expect(voteAll(nominate(game, 0), 'ja').phase).toBe('legislation_president');
  });

  it('liberals win when Hitler is executed', () => {
    const game = makeGame(5, { presidentIndex: 3, phase: 'executive_action', fascistPolicies: 4 });
    expect(executePlayer(game, 0)).toMatchObject({ phase: 'game_over', winner: 'liberal' });
  });
});

describe('presidential powers by player count', () => {
  it.each([
    // [players, fascist policies, expected power]
    [5, 1, null], [5, 2, null], [5, 3, 'peek'], [5, 4, 'execution'], [5, 5, 'execution'],
    [6, 3, 'peek'],
    [7, 1, null], [7, 2, 'investigate'], [7, 3, 'special_election'], [7, 4, 'execution'], [7, 5, 'execution'],
    [8, 2, 'investigate'],
    [9, 1, 'investigate'], [9, 2, 'investigate'], [9, 3, 'special_election'], [9, 4, 'execution'], [9, 5, 'execution'],
    [10, 1, 'investigate'],
  ])('%i players, fascist policy #%i → %s', (n, f, power) => {
    expect(getExecutiveAction(n, f)).toBe(power);
  });

  it('enacting a power-granting fascist policy moves to executive action', () => {
    let g = voteAll(nominate(makeGame(7, { fascistPolicies: 1, drawPile: deck('F', 'F', 'F') }), 1), 'ja');
    g = chancellorEnact(presidentDiscard(drawCards(g), 0), 0);
    expect(g.phase).toBe('executive_action');
  });
});

describe('execution', () => {
  const atExecution = () => makeGame(7, { presidentIndex: 3, phase: 'executive_action', fascistPolicies: 4 });

  it('kills the target and passes the presidency on', () => {
    const game = executePlayer(atExecution(), 5);
    expect(game.players[5].isAlive).toBe(false);
    expect(game.phase).toBe('nomination');
    expect(game.presidentIndex).toBe(4);
  });

  it('president cannot execute themselves', () => {
    expect(() => executePlayer(atExecution(), 3)).toThrow();
  });

  it('cannot execute a dead player', () => {
    const game = executePlayer(atExecution(), 5);
    expect(() => executePlayer({ ...game, phase: 'executive_action' }, 5)).toThrow();
  });
});

describe('investigation', () => {
  const atInvestigation = () => makeGame(7, { presidentIndex: 3, phase: 'executive_action', fascistPolicies: 2 });

  it('reveals party membership, not role: Hitler shows as fascist', () => {
    expect(investigatePlayer(atInvestigation(), 0).party).toBe('fascist');
    expect(investigatePlayer(atInvestigation(), 5).party).toBe('liberal');
  });

  it('a player cannot be investigated twice', () => {
    const { game } = investigatePlayer(atInvestigation(), 5);
    expect(() => investigatePlayer({ ...game, phase: 'executive_action' }, 5)).toThrow();
  });

  it('president cannot investigate themselves', () => {
    expect(() => investigatePlayer(atInvestigation(), 3)).toThrow();
  });
});

describe('special election', () => {
  const atSpecialElection = () => makeGame(7, { presidentIndex: 2, phase: 'executive_action', fascistPolicies: 3 });

  it('the chosen player becomes the next president', () => {
    const game = specialElection(atSpecialElection(), 5);
    expect(game.presidentIndex).toBe(5);
    expect(game.phase).toBe('nomination');
  });

  it('president cannot choose themselves', () => {
    expect(() => specialElection(atSpecialElection(), 2)).toThrow();
  });

  it('cannot choose a dead player', () => {
    const base = atSpecialElection();
    const game = { ...base, players: base.players.map((p, i) => (i === 5 ? { ...p, isAlive: false } : p)) };
    expect(() => specialElection(game, 5)).toThrow();
  });

  it('after the special president, the order returns to the left of the president who called it', () => {
    // President 2 picks player 5. After 5's term the next president is 3, not 6.
    const game = failElection(specialElection(atSpecialElection(), 5), 1);
    expect(game.presidentIndex).toBe(3);
  });

  it('the special president can be the player who would have been next anyway', () => {
    // President 2 picks 3. After 3's term, 3 presides again (official rules).
    const game = failElection(specialElection(atSpecialElection(), 3), 1);
    expect(game.presidentIndex).toBe(3);
  });
});

describe('policy peek', () => {
  it('shows the top 3 cards without changing the deck', () => {
    const game = makeGame(5, { drawPile: deck('F', 'L', 'F', 'L') });
    expect(peekCards(game)).toEqual(deck('F', 'L', 'F'));
    expect(game.drawPile).toEqual(deck('F', 'L', 'F', 'L'));
  });

  it('the peeked cards are the ones the next president draws, even across a reshuffle', () => {
    // 5 players: the 3rd fascist policy grants peek. Only 2 cards remain after this session,
    // so the deck is reshuffled and the peek must see that reshuffled deck.
    // Repeated because the reshuffle is random: a broken peek can match by chance
    for (let i = 0; i < 50; i++) {
      let game = makeGame(5, { fascistPolicies: 2, drawPile: deck('F', 'F', 'F', 'L', 'L'), discardPile: deck('L', 'F', 'L', 'F') });
      game = voteAll(nominate(game, 1), 'ja');
      game = chancellorEnact(presidentDiscard(drawCards(game), 0), 0);
      expect(game.phase).toBe('executive_action');

      const peeked = peekCards(game);
      game = drawCards(voteAll(nominate(finishPolicyEnacted(game), 2), 'ja'));
      expect(game.drawnCards).toEqual(peeked);
    }
  });
});
