import { describe, it, expect } from 'vitest';
import { evaluateClaim } from '../src/game/claims.js';

describe('evaluateClaim', () => {
  it('a claim matching the actual cards is truthful, in any order', () => {
    expect(evaluateClaim(['fascist', 'liberal', 'fascist'], ['liberal', 'fascist', 'fascist'])).toBe(true);
  });

  it('a claim with different cards is not truthful', () => {
    expect(evaluateClaim(['fascist', 'liberal', 'fascist'], ['fascist', 'fascist', 'fascist'])).toBe(false);
  });

  it('a claim with the wrong number of cards is not truthful', () => {
    expect(evaluateClaim(['fascist', 'liberal'], ['fascist'])).toBe(false);
  });

  it('declining to claim is neither truthful nor a lie', () => {
    expect(evaluateClaim(['fascist', 'liberal'], null)).toBeNull();
  });

  it('works for an investigated party', () => {
    expect(evaluateClaim(['fascist'], ['liberal'])).toBe(false);
  });
});
