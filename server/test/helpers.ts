import { createGame } from '../src/game/engine.js';
import type { LLMClient } from '../src/server/conversation.js';
import type { GameState, PolicyCard, Role } from '../src/game/types.js';

// Build a game with fixed roles and president, so tests don't depend on shuffles.
// Roles default to: player 0 = hitler, then the right number of fascists, rest liberal.
export function makeGame(
  playerCount: number,
  overrides: Partial<GameState> & { roles?: Role[] } = {}
): GameState {
  const setup = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    model: 'mock',
  }));
  const game = createGame('test', setup);

  const fascistCount = playerCount <= 6 ? 1 : playerCount <= 8 ? 2 : 3;
  const roles: Role[] =
    overrides.roles ??
    Array.from({ length: playerCount }, (_, i) =>
      i === 0 ? 'hitler' : i <= fascistCount ? 'fascist' : 'liberal'
    );

  const { roles: _ignored, ...rest } = overrides;
  return {
    ...game,
    players: game.players.map((p, i) => ({ ...p, role: roles[i] })),
    presidentIndex: 0,
    ...rest,
  };
}

export function deck(...cards: Array<'L' | 'F'>): PolicyCard[] {
  return cards.map((c) => (c === 'L' ? 'liberal' : 'fascist'));
}

type Reply = string | Error;

// An LLM client with scripted replies: one fixed reply, or one per player model.
// `calls` counts the requests made.
export function fakeClient(reply: Reply | ((model: string) => Reply)): LLMClient & { calls: number } {
  const client = {
    calls: 0,
    chat: async (model: string) => {
      client.calls++;
      const r = typeof reply === 'function' ? reply(model) : reply;
      if (r instanceof Error) throw r;
      return { content: r, model: 'fake', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, cost: 0 };
    },
  };
  return client as unknown as LLMClient & { calls: number };
}
