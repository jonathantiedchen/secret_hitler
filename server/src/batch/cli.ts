// Play a batch of games without the UI, for experiments.
//
//   npm run batch -- <config.json> [--dry-run] [--concurrency N] [--retry-aborted] [--quiet] [--verbose]
//
// Every matchup plays every seed, so matchups meet identical deals. Logs go to <repo>/logs/<name>
// (or the config's outputDir, relative to the config file). Running the same config again skips the
// games already finished. Real models need OPENROUTER_API_KEY. Ctrl+C stops starting new games;
// a second Ctrl+C quits at once. --retry-aborted also replays games aborted because a player gave no
// usable reply (kept as results otherwise), e.g. after fixing how replies are read.
// While games run, every step and what players say is printed, tagged with its game, with a status of
// the running games every minute; --quiet prints only game starts, results and the status.

import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandGames, isMockModel, parseBatchConfig, type BatchConfig } from './config.js';
import { createProgress, duration, money } from './progress.js';
import { findFinishedGames, runBatch, type GameResult } from './runner.js';

const REPO_LOGS = fileURLToPath(new URL('../../../logs', import.meta.url));
const DEFAULT_COST_LIMIT = 1;
const STATUS_EVERY_MS = 60_000;
const USAGE = 'Usage: npm run batch -- <config.json> [--dry-run] [--concurrency N] [--retry-aborted] [--quiet] [--verbose]';

const out = (line = '') => process.stdout.write(`${line}\n`);

function parseArgs(argv: string[]) {
  const args = { config: undefined as string | undefined, dryRun: false, concurrency: undefined as number | undefined, verbose: false, quiet: false, retryAborted: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--retry-aborted') args.retryAborted = true;
    else if (a === '--concurrency') {
      args.concurrency = Number(argv[++i]);
      if (!Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error('--concurrency needs a positive integer');
    } else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else args.config = a;
  }
  if (!args.config) throw new Error(USAGE);
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
  const finished = findFinishedGames(outputDir, args.retryAborted);
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

  // Game internals log every request; the progress lines below show the steps instead, unless asked
  if (!args.verbose) console.log = console.warn = console.error = () => {};

  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    out('\nStopping: no new games will start (running games finish). Press Ctrl+C again to quit now.');
  });

  out();
  const progress = createProgress({
    specs,
    toPlay: specs.length - alreadyPlayed,
    quiet: args.quiet,
    write: out,
    color: !!process.stdout.isTTY && !process.env.NO_COLOR,
  });
  const status = setInterval(() => progress.status(), STATUS_EVERY_MS);
  const startedAt = Date.now();
  const { results, stopReason } = await runBatch(specs, {
    batchName: config.name,
    outputDir,
    apiKey,
    concurrency,
    retryAborted: args.retryAborted,
    maxTotalCost: config.maxTotalCost,
    settings: { ...config.settings, costLimit },
    stopRequested: () => (interrupted ? 'interrupted' : null),
    onGameStart: progress.gameStarted,
    onGameEvent: progress.gameEvent,
    onGameEnd: progress.gameEnded,
  });
  clearInterval(status);

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
