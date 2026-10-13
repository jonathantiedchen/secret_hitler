import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractCost, OpenRouterClient } from '../src/ai/openrouter.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('extractCost', () => {
  const usage = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 };
  const pricing = { prompt: 0.00000015, completion: 0.0000006 };

  it('uses the cost OpenRouter reports', () => {
    expect(extractCost({ ...usage, cost: 0.0042 }, pricing)).toEqual({ cost: 0.0042, costSource: 'reported' });
  });

  it('a reported cost of 0 (free model) is still reported', () => {
    expect(extractCost({ ...usage, cost: 0 }, pricing)).toEqual({ cost: 0, costSource: 'reported' });
  });

  it('without a reported cost, computes it from the model\'s per-token price', () => {
    const { cost, costSource } = extractCost(usage, pricing);
    expect(costSource).toBe('estimated');
    expect(cost).toBeCloseTo(1000 * 0.00000015 + 200 * 0.0000006, 12);
  });

  it('without either, the cost is unknown', () => {
    expect(extractCost(usage, undefined)).toEqual({ cost: 0, costSource: 'unknown' });
  });
});

describe('OpenRouterClient empty responses', () => {
  it('says why a response had no text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      provider: 'Anthropic',
      choices: [{ message: { content: '', refusal: 'I cannot help with that.' }, finish_reason: 'stop', native_finish_reason: 'refusal' }],
      usage: { completion_tokens: 0 },
    }) }));
    await expect(new OpenRouterClient('key').chat('anthropic/claude-sonnet-5.5', [])).rejects.toThrow(
      'OpenRouter returned empty response (finish_reason: stop; native_finish_reason: refusal; refusal: I cannot help with that.; 0 completion tokens; provider: Anthropic)'
    );
  });

  it('notes a response that is only reasoning', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      choices: [{ message: { content: null, reasoning: 'Let me think about the nomination' }, finish_reason: 'length' }],
    }) }));
    await expect(new OpenRouterClient('key').chat('m', [])).rejects.toThrow(/finish_reason: length; reasoning only \(33 characters\)/);
  });
});

describe('OpenRouterClient cost', () => {
  function completion(usage: Record<string, unknown>) {
    return { ok: true, json: async () => ({ model: 'openai/gpt-4o-mini', choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage }) };
  }
  const models = { ok: true, json: async () => ({ data: [{ id: 'openai/gpt-4o-mini', pricing: { prompt: '0.00000015', completion: '0.0000006' } }] }) };

  it('returns the reported cost without fetching prices', async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0001 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await new OpenRouterClient('key').chat('openai/gpt-4o-mini', []);
    expect(res).toMatchObject({ cost: 0.0001, costSource: 'reported' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to listed prices, fetching the price list only once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn((url: string) => Promise.resolve(url.endsWith('/models') ? models : completion({ prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 })));
    vi.stubGlobal('fetch', fetchMock);
    const client = new OpenRouterClient('key');
    const first = await client.chat('openai/gpt-4o-mini', []);
    await client.chat('openai/gpt-4o-mini', []);
    expect(first.costSource).toBe('estimated');
    expect(first.cost).toBeCloseTo(0.00027, 10);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/models'))).toHaveLength(1);
  });
});
