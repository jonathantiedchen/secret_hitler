import { describe, it, expect } from 'vitest';
import { extractJson } from '../src/ai/json.js';

describe('extractJson', () => {
  it('takes a bare JSON reply as it is', () => {
    expect(extractJson('{"action":{"type":"vote","vote":"ja"}}')).toEqual({ value: { action: { type: 'vote', vote: 'ja' } }, unwrapped: false });
  });

  it.each([
    ['a ```json fence', '```json\n{"action":{"type":"vote","vote":"ja"}}\n```'],
    ['a bare ``` fence', '```\n{"action":{"type":"vote","vote":"ja"}}\n```'],
    ['a sentence around it', 'Here is my decision:\n{"action":{"type":"vote","vote":"ja"}}\nGood luck!'],
  ])('takes the object out of %s', (_name, reply) => {
    expect(extractJson(reply)).toEqual({ value: { action: { type: 'vote', vote: 'ja' } }, unwrapped: true });
  });

  it('reads line breaks and tabs written raw inside strings, keeping them in the text', () => {
    const reply = '{\n  "thought": "Deck math:\nR1: 3 F out.\tStill \\"unlucky\\"?",\n  "action": {"type": "vote", "vote": "ja"}\n}';
    expect(extractJson(reply)).toEqual({
      value: { thought: 'Deck math:\nR1: 3 F out.\tStill "unlucky"?', action: { type: 'vote', vote: 'ja' } },
      unwrapped: true,
    });
  });

  it.each([
    ['no JSON at all', 'I vote ja.'],
    ['an unescaped quote inside a string', '{"thought": "He said "yes"\nso I vote", "action": {"type": "vote", "vote": "ja"}}'],
    ['a cut-off object', '```json\n{"thought":"a very long'],
    ['a list, not an object', 'Answer: [1, 2]'],
  ])('finds nothing in %s', (_name, reply) => {
    expect(extractJson(reply)).toBeNull();
  });
});
