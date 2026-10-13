// Batch config: which matchups to play, under which lying instructions, on which seeds.
// Every matchup plays every seed under every instruction, so all of them meet identical deals.

import { isSeed } from '../game/random.js';
import { DEFAULT_LYING_INSTRUCTION, LYING_INSTRUCTIONS, isLyingInstruction, type LyingInstruction } from '../ai/prompts.js';

export interface BatchSettings {
  temperature?: number;
  maxTokens?: number;
  // How long to wait for one reply (default 60); reasoning models can need minutes
  requestTimeoutSeconds?: number;
  // USD per game; a batch game that reaches it is stopped and logged as aborted
  costLimit?: number;
  maxHistoryMessages?: number;
}

export interface Matchup {
  label: string;
  // One model per seat, in seat order
  models: string[];
}

export interface BatchConfig {
  name: string;
  seeds: number[];
  matchups: Matchup[];
  // The experimental conditions: what players are told about lying
  lyingInstructions: LyingInstruction[];
  concurrency: number;
  // USD for one run of the batch: no new game starts once it is spent
  maxTotalCost: number | null;
  outputDir: string | null;
  settings: BatchSettings;
}

export interface GameSpec {
  gameId: string;
  matchup: string;
  lyingInstruction: LyingInstruction;
  seed: number;
  players: Array<{ id: string; name: string; model: string }>;
}

// The same seat names the setup screen uses
const PLAYER_NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'];
// Batch names and labels become part of game ids and log file names
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MOCK_MODELS = new Set(['mock', 'mock-invalid']);

export const isMockModel = (model: string) => MOCK_MODELS.has(model);

const fail = (message: string): never => {
  throw new Error(message);
};

function checkKeys(value: Record<string, unknown>, allowed: string[], where: string) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${where}: unknown key "${key}" (allowed: ${allowed.join(', ')})`);
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function positiveNumber(value: unknown, where: string): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fail(`${where} must be a positive number`);
}

function parseSeeds(value: unknown): number[] {
  let seeds: unknown[];
  if (Array.isArray(value)) {
    seeds = value;
  } else if (isObject(value)) {
    checkKeys(value, ['from', 'count'], 'seeds');
    const { from, count } = value;
    if (!isSeed(from)) fail('seeds.from must be an integer from 0 to 4294967295');
    if (!Number.isInteger(count) || (count as number) < 1) fail('seeds.count must be a positive integer');
    seeds = Array.from({ length: count as number }, (_, i) => (from as number) + i);
  } else {
    return fail('seeds must be a list of integers or { "from": <seed>, "count": <n> }');
  }
  if (seeds.length === 0) fail('seeds must not be empty');
  seeds.forEach((seed, i) => isSeed(seed) || fail(`seeds[${i}] must be an integer from 0 to 4294967295`));
  if (new Set(seeds).size !== seeds.length) fail('seeds must not repeat');
  return seeds as number[];
}

function parseMatchup(value: unknown, i: number): Matchup {
  const where = `matchups[${i}]`;
  if (!isObject(value)) return fail(`${where} must be an object`);
  checkKeys(value, ['label', 'model', 'players', 'models'], where);
  const { label } = value;
  if (typeof label !== 'string' || !SLUG.test(label)) {
    fail(`${where}.label must be letters, digits, ".", "_" or "-" (it is used in game ids and file names)`);
  }

  let models: unknown[];
  if (value.models !== undefined) {
    if (value.model !== undefined || value.players !== undefined) fail(`${where}: give either "models" or "model" with "players", not both`);
    if (!Array.isArray(value.models)) return fail(`${where}.models must be a list of model ids, one per seat`);
    models = value.models;
  } else {
    const { model, players } = value;
    if (!Number.isInteger(players)) fail(`${where}.players must be an integer from 5 to 10`);
    models = Array(players as number).fill(model);
  }
  if (models.length < 5 || models.length > 10) fail(`${where} must have 5 to 10 players`);
  models.forEach((model, seat) => (typeof model === 'string' && model.trim() !== '') || fail(`${where}: seat ${seat} needs a model id`));
  return { label: label as string, models: models as string[] };
}

function parseLyingInstructions(value: unknown): LyingInstruction[] {
  if (value === undefined) return [DEFAULT_LYING_INSTRUCTION];
  if (!Array.isArray(value) || value.length === 0) return fail('lyingInstructions must be a non-empty list');
  value.forEach((v, i) => isLyingInstruction(v) || fail(`lyingInstructions[${i}] must be one of: ${LYING_INSTRUCTIONS.join(', ')}`));
  if (new Set(value).size !== value.length) fail('lyingInstructions must not repeat');
  return value as LyingInstruction[];
}

function parseSettings(value: unknown): BatchSettings {
  if (value === undefined) return {};
  if (!isObject(value)) return fail('settings must be an object');
  checkKeys(value, ['temperature', 'maxTokens', 'requestTimeoutSeconds', 'costLimit', 'maxHistoryMessages'], 'settings');
  const settings: BatchSettings = {};
  if (value.temperature !== undefined) {
    const t = value.temperature;
    settings.temperature = typeof t === 'number' && t >= 0 && t <= 2 ? t : fail('settings.temperature must be a number from 0 to 2');
  }
  for (const key of ['maxTokens', 'maxHistoryMessages'] as const) {
    if (value[key] !== undefined) {
      settings[key] = Number.isInteger(value[key]) && (value[key] as number) > 0 ? (value[key] as number) : fail(`settings.${key} must be a positive integer`);
    }
  }
  if (value.costLimit !== undefined) settings.costLimit = positiveNumber(value.costLimit, 'settings.costLimit');
  if (value.requestTimeoutSeconds !== undefined) settings.requestTimeoutSeconds = positiveNumber(value.requestTimeoutSeconds, 'settings.requestTimeoutSeconds');
  return settings;
}

// Validate a parsed config file. Throws an Error naming the first problem.
export function parseBatchConfig(raw: unknown): BatchConfig {
  if (!isObject(raw)) return fail('the config must be a JSON object');
  checkKeys(raw, ['name', 'seeds', 'matchups', 'lyingInstructions', 'concurrency', 'maxTotalCost', 'outputDir', 'settings'], 'config');
  const { name } = raw;
  if (typeof name !== 'string' || !SLUG.test(name)) fail('name must be letters, digits, ".", "_" or "-" (it is used in game ids and file names)');

  if (!Array.isArray(raw.matchups) || raw.matchups.length === 0) fail('matchups must be a non-empty list');
  const matchups = (raw.matchups as unknown[]).map(parseMatchup);
  const labels = matchups.map((m) => m.label);
  if (new Set(labels).size !== labels.length) fail('matchup labels must be unique');
  const models = matchups.flatMap((m) => m.models);
  if (models.some(isMockModel) && !models.every(isMockModel)) fail('mock models cannot be mixed with real models in one batch');

  const concurrency = raw.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || (concurrency as number) < 1) fail('concurrency must be a positive integer');
  if (raw.outputDir !== undefined && (typeof raw.outputDir !== 'string' || raw.outputDir === '')) fail('outputDir must be a path');

  return {
    name: name as string,
    seeds: parseSeeds(raw.seeds),
    matchups,
    lyingInstructions: parseLyingInstructions(raw.lyingInstructions),
    concurrency: concurrency as number,
    maxTotalCost: raw.maxTotalCost === undefined ? null : positiveNumber(raw.maxTotalCost, 'maxTotalCost'),
    outputDir: (raw.outputDir as string | undefined) ?? null,
    settings: parseSettings(raw.settings),
  };
}

// One game per seed, instruction and matchup, seed by seed, so a batch stopped early stays
// balanced across instructions and matchups
export function expandGames(config: BatchConfig): GameSpec[] {
  return config.seeds.flatMap((seed) =>
    config.lyingInstructions.flatMap((lyingInstruction) =>
      config.matchups.map((matchup) => ({
        gameId: `${config.name}-${matchup.label}-${lyingInstruction}-s${seed}`,
        matchup: matchup.label,
        lyingInstruction,
        seed,
        players: matchup.models.map((model, seat) => ({ id: `player-${seat}`, name: `Agent ${PLAYER_NAMES[seat]}`, model })),
      }))
    )
  );
}
