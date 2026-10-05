// Compare a player's public claim with what they actually saw

// Cards (or a single investigated party) as a multiset: order doesn't matter.
// Returns null when the player declined to claim.
export function evaluateClaim(actual: string[], claimed: string[] | null): boolean | null {
  if (claimed === null) return null;
  if (claimed.length !== actual.length) return false;
  const sorted = (xs: string[]) => xs.map((x) => x.toLowerCase()).sort().join(',');
  return sorted(actual) === sorted(claimed);
}
