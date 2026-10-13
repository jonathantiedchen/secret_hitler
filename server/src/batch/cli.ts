// Play a batch of games without the UI, for experiments.
//
//   npm run batch -- <config.json> [--dry-run] [--concurrency N] [--verbose]
//
// Every matchup plays every seed, so matchups meet identical deals. Logs go to <repo>/logs/<name>
// (or the config's outputDir, relative to the config file). Running the same config again skips the
// games already finished. Real models need OPENROUTER_API_KEY. Ctrl+C stops starting new games;
// a second Ctrl+C quits at once.

import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandGames, isMockModel, parseBatchConfig, type BatchConfig } from './config.js';
import { findFinishedGames, isInfrastructureFailure, runBatch, type GameResult } from './runner.js';

const REPO_LOGS = fileURLToPath(new URL('../../../logs', import.meta.url));
const DEFAULT_COST_LIMIT = 1;

const out = (line = '') => process.stdout.write(`${line}\n`);

function parseArgs(argv: string[]) {
  const args = { config: undefined as string | undefined, dryRun: false, concurrency: undefined as number | undefined, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--concurrency') {
      args.concurrency = Number(argv[++i]);
      if (!Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error('--concurrency needs a positive integer');
    } else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else args.config = a;
  }
  if (!args.config) throw new Error('Usage: npm run batch -- <config.json> [--dry-run] [--concurrency N] [--verbose]');
  return args as typeof args & { config: string };
}

function loadConfig(path: string): BatchConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return parseBatchConfig(raw);
  } catch (error) {
    throw new Error(`Invalid config ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const money = (usd: number) => `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
const duration = (ms: number) => `${Math.floor(ms / 60000)}m${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}s`;

function describeAbort(result: GameResult): string {
  const reason = result.abortReason;
  if (!reason) return 'stopped';
  if ('reasons' in reason) {
    const player = result.spec.players.find((p) => p.id === reason.playerId);
    const who = `${player?.name ?? reason.playerId} (${reason.model})`;
    return isInfrastructureFailure(reason)
      ? `requests for ${who} in ${reason.phase} failed: ${reason.reasons.at(-1)?.replace(/^request failed: /, '')}`
      : `${who} gave no usable response in ${reason.phase}: ${reason.reasons.at(-1)}`;
  }
  return reason.message;
}

function summaryTable(config: BatchConfig, results: GameResult[]) {
  const rows = config.matchups.flatMap((m) => config.lyingInstructions.map((instruction) => {
    const cell = results.filter((r) => r.spec.matchup === m.label && r.spec.lyingInstruction === instruction);
    const of = (outcome: string) => cell.filter((r) => r.outcome === outcome);
    const played = [...of('completed'), ...of('skipped').filter((r) => !r.abortReason)];
    return [
      m.label,
      instruction,
      String(of('completed').length),
      String(of('aborted').length),
      String(of('skipped').length),
      String(of('not_started').length),
      `${played.filter((r) => r.winner === 'liberal').length}/${played.filter((r) => r.winner === 'fascist').length}`,
      money(cell.reduce((sum, r) => sum + r.cost, 0)),
    ];
  }));
  const headers = ['matchup', 'lying', 'completed', 'aborted', 'skipped', 'not started', 'lib/fas wins', 'cost'];
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i < 2 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  out(line(headers));
  out(widths.map((w) => '-'.repeat(w)).join('  '));
  rows.forEach((r) => out(line(r)));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = resolve(args.config);
  const config = loadConfig(configPath);
  const specs = expandGames(config);
  const outputDir = config.outputDir ? resolve(dirname(configPath), config.outputDir) : resolve(REPO_LOGS, config.name);
  const concurrency = args.concurrency ?? config.concurrency;
  const mock = specs.every((s) => s.players.every((p) => isMockModel(p.model)));
  const costLimit = config.settings.costLimit ?? DEFAULT_COST_LIMIT;
  const finished = findFinishedGames(outputDir);
  const alreadyPlayed = specs.filter((s) => finished.has(s.gameId)).length;

  out(`Batch "${config.name}": ${config.matchups.length} matchup(s) x ${config.lyingInstructions.length} lying instruction(s) x ${config.seeds.length} seed(s) = ${specs.length} games`);
  for (const m of config.matchups) {
    const models = [...new Set(m.models)];
    out(`  ${m.label}: ${m.models.length} players, ${models.length === 1 ? models[0] : m.models.join(', ')}`);
  }
  out(`Lying instructions: ${config.lyingInstructions.join(', ')}`);
  out(`Seeds: ${config.seeds.length > 6 ? `${config.seeds.slice(0, 3).join(', ')}, ..., ${config.seeds.at(-1)}` : config.seeds.join(', ')}`);
  out(`Already played: ${alreadyPlayed}; to play: ${specs.length - alreadyPlayed}`);
  out(`Concurrency ${concurrency}, cost limit $${costLimit.toFixed(2)} per game, budget ${config.maxTotalCost ? `$${config.maxTotalCost.toFixed(2)}` : 'none'}`);
  out(`Logs: ${relative(process.cwd(), outputDir) || '.'}${mock ? ' (mock models)' : ''}`);
  if (args.dryRun) return 0;

  const apiKey = mock ? null : process.env.OPENROUTER_API_KEY ?? null;
  if (!mock && !apiKey) throw new Error('Set OPENROUTER_API_KEY to play real models');

  // Game internals log every request; keep the output to one line per game unless asked
  if (!args.verbose) console.log = console.warn = console.error = () => {};

  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    out('\nStopping: no new games will start (running games finish). Press Ctrl+C again to quit now.');
  });

  out();
  const toPlay = specs.length - alreadyPlayed;
  let done = 0;
  const startedAt = Date.now();
  const { results, stopReason } = await runBatch(specs, {
    batchName: config.name,
    outputDir,
    apiKey,
    concurrency,
    maxTotalCost: config.maxTotalCost,
    settings: { ...config.settings, costLimit },
    stopRequested: () => (interrupted ? 'interrupted' : null),
    onGameEnd: (r) => {
      done++;
      const what = r.outcome === 'completed' ? `completed  ${r.winner} win, ${r.rounds} rounds` : `ABORTED    ${describeAbort(r)}`;
      out(`[${String(done).padStart(String(toPlay).length)}/${toPlay}] ${r.spec.matchup}  ${r.spec.lyingInstruction}  seed ${r.spec.seed}  ${what}  ${money(r.cost)}  ${duration(r.durationMs)}`);
    },
  });

  out();
  summaryTable(config, results);
  const spent = results.reduce((sum, r) => sum + r.cost, 0);
  out();
  out(`Spent ${money(spent)} in ${duration(Date.now() - startedAt)}.${stopReason ? ` Stopped early: ${stopReason}.` : ''}`);
  if (results.some((r) => r.outcome === 'not_started')) out('Run the same command again to play the remaining games.');
  out(`Analyze: npm run analyze -- ${relative(process.cwd(), outputDir) || '.'}${mock ? ' --include-mock' : ''}`);
  return stopReason && stopReason !== 'interrupted' && !stopReason.startsWith('budget') ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
);
