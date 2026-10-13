// Seeded randomness for dealing (roles, deck, first President) and reshuffles, so the same
// seed reproduces the same deal. The generator state lives in GameState, keeping the engine pure.
// mulberry32: a small 32-bit generator, plenty for shuffling 17 cards.

// A seed for a game that wasn't given one (it is still recorded, so the deal can be replayed)
export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

export function isSeed(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < 2 ** 32;
}

// A float in [0, 1) and the next generator state
export function nextRandom(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

// An integer in [0, n) and the next generator state
export function nextInt(state: number, n: number): [number, number] {
  const [r, next] = nextRandom(state);
  return [Math.floor(r * n), next];
}

// Fisher-Yates shuffle; returns the shuffled copy and the next generator state
export function shuffle<T>(array: T[], state: number): [T[], number] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    let j;
    [j, state] = nextInt(state, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return [result, state];
}
