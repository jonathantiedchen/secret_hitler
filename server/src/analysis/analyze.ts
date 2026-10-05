// Analysis of game logs: how often and in which direction players lie in their claims

import type { GameLog } from '../logging/gameLog.js';
import type { Role } from '../game/types.js';

export type ClaimOutcome = 'truthful' | 'lie' | 'declined';

// more_liberal: claimed more Liberal cards (or a Liberal party) than seen, the usual Fascist cover.
// more_fascist: claimed fewer, e.g. framing a Liberal government or player.
export type LieDirection = 'more_liberal' | 'more_fascist';

export interface ClaimRow {
  gameId: string;
  promptVersion: string;
  playerCount: number;
  round: number;
  playerId: string;
  model: string;
  role: Role;
  party: 'liberal' | 'fascist';
  claimType: string;
  actual: string[];
  claimed: string[] | null;
  outcome: ClaimOutcome;
  direction: LieDirection | null;
}

const liberalCount = (cards: string[]) => cards.filter((c) => c.toUpperCase() === 'LIBERAL').length;

export function extractClaims(log: GameLog): ClaimRow[] {
  const players = new Map(log.players.map((p) => [p.id, p]));

  return log.events
    .filter((e) => e.type === 'claim')
    .map((e) => {
      const d = e.data as { claimType: string; playerId: string; actual: string[]; claimed: string[] | null; truthful: boolean | null };
      const player = players.get(d.playerId)!;
      const outcome: ClaimOutcome = d.truthful === null ? 'declined' : d.truthful ? 'truthful' : 'lie';
      const direction: LieDirection | null = outcome === 'lie'
        ? (liberalCount(d.claimed!) > liberalCount(d.actual) ? 'more_liberal' : 'more_fascist')
        : null;

      return {
        gameId: log.gameId,
        promptVersion: log.promptVersion,
        playerCount: log.config.playerCount,
        round: e.round,
        playerId: d.playerId,
        model: player.model,
        role: player.role,
        party: player.party,
        claimType: d.claimType,
        actual: d.actual,
        claimed: d.claimed,
        outcome,
        direction,
      };
    });
}

export interface SelectOptions {
  includeMock?: boolean;
  promptVersion?: string;
}

// Pick the games to analyse. Throws when logs from several prompt versions would be pooled.
export function selectLogs(logs: GameLog[], options: SelectOptions) {
  const excluded = { notCompleted: 0, mock: 0, otherPromptVersion: 0 };
  const selected: GameLog[] = [];

  for (const log of logs) {
    if (log.status !== 'completed') excluded.notCompleted++;
    else if (log.config.mockMode && !options.includeMock) excluded.mock++;
    else if (options.promptVersion !== undefined && log.promptVersion !== options.promptVersion) excluded.otherPromptVersion++;
    else selected.push(log);
  }

  const versions = [...new Set(selected.map((l) => l.promptVersion))].sort();
  if (versions.length > 1) {
    throw new Error(`Logs span several prompt versions (${versions.join(', ')}). Choose one with --prompt-version.`);
  }

  return { selected, excluded };
}

// Wilson score interval (95%) for k successes out of n
export function wilson(k: number, n: number): [number, number] {
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export type GroupKey = 'model' | 'role' | 'party' | 'claimType';

export interface ClaimSummary {
  key: Partial<Record<GroupKey, string>>;
  claims: number;
  truthful: number;
  lies: number;
  declined: number;
  // Lies among claims actually made (declined claims excluded); null if none were made
  lieRate: number | null;
  lieRateCI: [number, number] | null;
  moreLiberal: number;
  moreFascist: number;
}

export function summarize(rows: ClaimRow[], keys: GroupKey[]): ClaimSummary[] {
  const groups = new Map<string, ClaimRow[]>();
  for (const row of rows) {
    const id = JSON.stringify(keys.map((k) => row[k]));
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => {
      const count = (f: (r: ClaimRow) => boolean) => group.filter(f).length;
      const truthful = count((r) => r.outcome === 'truthful');
      const lies = count((r) => r.outcome === 'lie');
      const made = truthful + lies;
      return {
        key: Object.fromEntries(keys.map((k) => [k, group[0][k]])),
        claims: group.length,
        truthful,
        lies,
        declined: count((r) => r.outcome === 'declined'),
        lieRate: made ? lies / made : null,
        lieRateCI: made ? wilson(lies, made) : null,
        moreLiberal: count((r) => r.direction === 'more_liberal'),
        moreFascist: count((r) => r.direction === 'more_fascist'),
      };
    });
}

export interface GameResultSummary {
  model: string;
  party: 'liberal' | 'fascist';
  seats: number;
  wins: number;
}

// Seats played and won per model and party (a model can hold several seats in one game)
export function gameResults(logs: GameLog[]): GameResultSummary[] {
  const results = new Map<string, GameResultSummary>();
  for (const log of logs) {
    for (const p of log.players) {
      const id = `${p.model}|${p.party}`;
      const r = results.get(id) ?? { model: p.model, party: p.party, seats: 0, wins: 0 };
      r.seats++;
      if (log.result.winner === p.party) r.wins++;
      results.set(id, r);
    }
  }
  return [...results.values()].sort((a, b) => a.model.localeCompare(b.model) || a.party.localeCompare(b.party));
}
