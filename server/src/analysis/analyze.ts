// Analysis of game logs: how often and in which direction players lie in their claims

import type { GameLog } from '../logging/gameLog.js';
import type { Role } from '../game/types.js';
import type { DialogueScores, JudgedAssertion } from './dialogue.js';

export type ClaimOutcome = 'truthful' | 'lie' | 'declined';

// more_liberal: claimed more Liberal cards (or a Liberal party) than seen, the usual Fascist cover.
// more_fascist: claimed fewer, e.g. framing a Liberal government or player.
export type LieDirection = 'more_liberal' | 'more_fascist';

export interface ClaimRow {
  gameId: string;
  promptVersion: string;
  // null / 'unrecorded' for logs written before seeds (log version 2) / lying instructions (3)
  seed: number | null;
  lyingInstruction: string;
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

// What the players of this game were told about lying
export const lyingInstructionOf = (log: GameLog): string => log.config.lyingInstruction ?? 'unrecorded';

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
        seed: log.seed ?? null,
        lyingInstruction: lyingInstructionOf(log),
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
  const excluded = { aborted: 0, inProgress: 0, mock: 0, otherPromptVersion: 0 };
  const selected: GameLog[] = [];

  for (const log of logs) {
    if (log.status === 'aborted') excluded.aborted++;
    else if (log.status !== 'completed') excluded.inProgress++;
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

export type GroupKey = 'model' | 'role' | 'party' | 'claimType' | 'lyingInstruction';

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
  // Set when results are split by lying instruction
  lyingInstruction?: string;
  model: string;
  party: 'liberal' | 'fascist';
  seats: number;
  wins: number;
}

// Seats played and won per model and party (a model can hold several seats in one game),
// optionally per lying instruction too
export function gameResults(logs: GameLog[], byLyingInstruction = false): GameResultSummary[] {
  const results = new Map<string, GameResultSummary>();
  for (const log of logs) {
    const instruction = byLyingInstruction ? { lyingInstruction: lyingInstructionOf(log) } : {};
    for (const p of log.players) {
      const id = `${instruction.lyingInstruction ?? ''}|${p.model}|${p.party}`;
      const r = results.get(id) ?? { ...instruction, model: p.model, party: p.party, seats: 0, wins: 0 };
      r.seats++;
      if (log.result.winner === p.party) r.wins++;
      results.set(id, r);
    }
  }
  return [...results.values()].sort((a, b) =>
    (a.lyingInstruction ?? '').localeCompare(b.lyingInstruction ?? '') || a.model.localeCompare(b.model) || a.party.localeCompare(b.party));
}

export interface DataQualitySummary {
  model: string;
  requests: number;
  // Replies that arrived but could not be used, so the model was asked again
  rejected: number;
  rejectionRate: number;
  // Requests that failed (network, API) and were resent
  requestErrors: number;
  // Games stopped because this model gave no usable decision after all retries
  gamesAborted: number;
}

// How reliably each model produced usable decisions. Pass every log, aborted games included.
export function dataQuality(logs: GameLog[]): DataQualitySummary[] {
  const byModel = new Map<string, DataQualitySummary>();
  const entry = (model: string) => {
    if (!byModel.has(model)) byModel.set(model, { model, requests: 0, rejected: 0, rejectionRate: 0, requestErrors: 0, gamesAborted: 0 });
    return byModel.get(model)!;
  };

  for (const log of logs) {
    const models = new Map(log.players.map((p) => [p.id, p.model]));
    for (const m of models.values()) entry(m);
    for (const call of log.llmCalls) {
      const e = entry(models.get(call.playerId)!);
      e.requests++;
      if (call.rejected) e.rejected++;
      if (call.error) e.requestErrors++;
    }
    if (log.abortReason && 'model' in log.abortReason) entry(log.abortReason.model).gamesAborted++;
  }

  return [...byModel.values()]
    .map((e) => ({ ...e, rejectionRate: e.requests ? e.rejected / e.requests : 0 }))
    .sort((a, b) => a.model.localeCompare(b.model));
}

// One statement a player said out loud, with the judge's assertions (null: the judge gave no answer)
export interface StatementRow {
  gameId: string;
  promptVersion: string;
  seed: number | null;
  lyingInstruction: string;
  round: number;
  phase: string;
  playerId: string;
  model: string;
  role: Role;
  party: 'liberal' | 'fascist';
  statement: string;
  assertions: JudgedAssertion[] | null;
}

export function extractStatements(log: GameLog, scores: DialogueScores): StatementRow[] {
  const players = new Map(log.players.map((p) => [p.id, p]));
  return scores.lines.flatMap((line) => {
    const player = players.get(line.playerId);
    if (!player) return [];
    return [{
      gameId: log.gameId,
      promptVersion: log.promptVersion,
      seed: log.seed ?? null,
      lyingInstruction: lyingInstructionOf(log),
      round: line.round,
      phase: line.phase,
      playerId: line.playerId,
      model: player.model,
      role: player.role,
      party: player.party,
      statement: line.content,
      assertions: line.assertions,
    }];
  });
}

export type StatementKey = 'model' | 'role' | 'party' | 'lyingInstruction' | 'topic';

export interface AssertionSummary {
  key: Partial<Record<StatementKey, string>>;
  assertions: number;
  truthful: number;
  lies: number;
  // Lies among checkable assertions; null if there were none
  lieRate: number | null;
  lieRateCI: [number, number] | null;
}

// Checkable assertions per group: one row per assertion, so a group can be a topic
export function summarizeAssertions(rows: StatementRow[], keys: StatementKey[]): AssertionSummary[] {
  const groups = new Map<string, Array<{ key: Partial<Record<StatementKey, string>>; assertion: JudgedAssertion }>>();
  for (const row of rows) {
    for (const assertion of row.assertions ?? []) {
      const key = Object.fromEntries(keys.map((k) => [k, k === 'topic' ? assertion.topic : String(row[k])]));
      const id = JSON.stringify(keys.map((k) => key[k]));
      groups.set(id, [...(groups.get(id) ?? []), { key, assertion }]);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => {
      const lies = group.filter((g) => g.assertion.verdict === 'lie').length;
      return {
        key: group[0].key,
        assertions: group.length,
        truthful: group.length - lies,
        lies,
        lieRate: lies / group.length,
        lieRateCI: wilson(lies, group.length),
      };
    });
}
