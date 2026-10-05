import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGameRecord, type GameRecord } from '../src/server/gameRecord.js';
import { askForDecision, DecisionFailedError, type Validation, type PlayerResponse } from '../src/server/conversation.js';
import type { LLMClient } from '../src/server/conversation.js';

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

type Reply = string | Error | { content: string; finishReason: string };

// Replies are used in order; records the last message of every request
function scripted(...replies: Reply[]) {
  const sent: string[] = [];
  const client = {
    chat: async (_model: string, messages: Array<{ content: string }>) => {
      sent.push(messages[messages.length - 1].content);
      const r = replies.shift();
      if (r === undefined) throw new Error('no more scripted replies');
      if (r instanceof Error) throw r;
      const { content, finishReason } = typeof r === 'string' ? { content: r, finishReason: 'stop' } : r;
      return { content, finishReason, model: 'fake', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, cost: 0, costSource: 'reported' };
    },
  };
  return { client: client as unknown as LLMClient, sent };
}

function game(): GameRecord {
  const players = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, model: 'fake' }));
  return createGameRecord(`test-${Math.random()}`, players, null, { retryBaseDelayMs: 0 });
}

// Accepts { "action": { "pick": "P1".."P4" } }
const pickPlayer = (r: PlayerResponse): Validation<string> => {
  const pick = r.action?.pick;
  return typeof pick === 'string' && ['P1', 'P2', 'P3', 'P4'].includes(pick)
    ? { ok: true, value: pick }
    : { ok: false, error: `"${String(pick)}" is not a valid choice. Valid choices: P1, P2, P3, P4.` };
};

const ask = (g: GameRecord, client: LLMClient) =>
  askForDecision(g, client, () => {}, () => {}, g.state.players[0], 'PHASE: TEST', 'test', pickPlayer);

describe('askForDecision', () => {
  it('returns the validated choice from a good first reply', async () => {
    const g = game();
    const { client, sent } = scripted('{"thought":"t","action":{"pick":"P2"},"dialogue":"hi"}');
    const result = await ask(g, client);
    expect(result.value).toBe('P2');
    expect(result.response.dialogue).toBe('hi');
    expect(sent).toHaveLength(1);
  });

  it('retries an illegal choice, telling the model why', async () => {
    const g = game();
    const { client, sent } = scripted('{"action":{"pick":"P0"}}', '{"action":{"pick":"P3"}}');
    expect((await ask(g, client)).value).toBe('P3');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/could not be used: "P0" is not a valid choice\. Valid choices: P1, P2, P3, P4\./);
  });

  it('retries a reply that is not JSON', async () => {
    const g = game();
    const { client, sent } = scripted('I pick P2', '{"action":{"pick":"P2"}}');
    expect((await ask(g, client)).value).toBe('P2');
    expect(sent[1]).toMatch(/not valid JSON/);
  });

  it('retries a reply cut off at the token limit, asking for a shorter one', async () => {
    const g = game();
    const { client, sent } = scripted({ content: '{"thought":"a very long', finishReason: 'length' }, '{"action":{"pick":"P1"}}');
    expect((await ask(g, client)).value).toBe('P1');
    expect(sent[1]).toMatch(/cut off/i);
  });

  it('retries a failed request with the same prompt', async () => {
    const g = game();
    const { client, sent } = scripted(new Error('503'), '{"action":{"pick":"P4"}}');
    expect((await ask(g, client)).value).toBe('P4');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
  });

  it('logs every attempt, marking rejected replies with the reason', async () => {
    const g = game();
    const { client } = scripted('{"action":{"pick":"P0"}}', '{"action":{"pick":"P3"}}');
    await ask(g, client);
    expect(g.llmCalls).toHaveLength(2);
    expect(g.llmCalls[0].rejected).toMatch(/not a valid choice/);
    expect(g.llmCalls[1].rejected).toBeUndefined();
  });

  it('records the thought of every attempt, numbering retries', async () => {
    const g = game();
    const { client } = scripted('{"thought":"first","action":{"pick":"P0"}}', '{"thought":"second","action":{"pick":"P3"}}');
    await ask(g, client);
    const thoughts = g.history.events.filter((e) => e.type === 'thought').map((e) => e.data);
    expect(thoughts).toEqual([
      { playerId: 'p0', playerName: 'P0', content: 'first' },
      { playerId: 'p0', playerName: 'P0', content: 'second', attempt: 2 },
    ]);
  });

  it('gives up after 3 unusable replies', async () => {
    const g = game();
    const { client, sent } = scripted('{"action":{"pick":"P0"}}', 'nope', '{"action":{"pick":"P9"}}', '{"action":{"pick":"P1"}}');
    const failure = await ask(g, client).catch((e) => e);
    expect(failure).toBeInstanceOf(DecisionFailedError);
    expect(failure.playerId).toBe('p0');
    expect(failure.reasons).toHaveLength(3);
    expect(sent).toHaveLength(3);
  });

  it('gives up after repeated request failures', async () => {
    const g = game();
    const { client } = scripted(new Error('503'), new Error('503'), new Error('503'), new Error('503'), '{"action":{"pick":"P1"}}');
    const failure = await ask(g, client).catch((e) => e);
    expect(failure).toBeInstanceOf(DecisionFailedError);
    expect(failure.message).toMatch(/503/);
  });
});
