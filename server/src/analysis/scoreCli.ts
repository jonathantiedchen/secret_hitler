// Score what players said out loud in a folder of game logs, with an LLM judge via OpenRouter.
// Scores go to <logs dir>/dialogue/<gameId>.json; npm run analyze reports them.
//
//   npm run score-dialogue -- <logs dir> --judge-model <model> [--concurrency N] [--max-cost USD] [--include-mock] [--dry-run]
//
// Running it again continues: statements already scored by the same judge are kept, and only
// missing or failed ones are sent. A different judge model (or judge prompt) scores games afresh.

import { OpenRouterClient } from '../ai/openrouter.js';
import { dialogueLines, readScores, writeScores, JUDGE_PROMPT_VERSION } from './dialogue.js';
import { sameJudge, scoreGame } from './judge.js';
import { loadLogs } from './logs.js';

const out = (line = '') => process.stdout.write(`${line}\n`);
const money = (usd: number) => `$${usd.toFixed(4)}`;

function parseArgs(argv: string[]) {
  const args = { dir: undefined as string | undefined, judgeModel: undefined as string | undefined, concurrency: 4, maxCost: null as number | null, includeMock: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--judge-model') args.judgeModel = argv[++i];
    else if (a === '--concurrency') args.concurrency = Number(argv[++i]);
    else if (a === '--max-cost') args.maxCost = Number(argv[++i]);
    else if (a === '--include-mock') args.includeMock = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else args.dir = a;
  }
  if (!args.dir) throw new Error('Usage: npm run score-dialogue -- <logs dir> --judge-model <model> [--concurrency N] [--max-cost USD] [--include-mock] [--dry-run]');
  if (!args.judgeModel) throw new Error('Choose the judge with --judge-model <OpenRouter model id>. Use a strong model; it is recorded with every score.');
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error('--concurrency needs a positive integer');
  if (args.maxCost !== null && !(args.maxCost > 0)) throw new Error('--max-cost needs a positive number');
  return args as typeof args & { dir: string; judgeModel: string };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // The same games the claim analysis uses: completed ones, mock games only on request
  const logs = loadLogs(args.dir).filter((l) => l.status === 'completed' && (args.includeMock || !l.config.mockMode));
  const plan = logs.map((log) => {
    const previous = readScores(args.dir, log.gameId);
    const done = sameJudge(previous, args.judgeModel) ? previous!.lines.filter((l) => l.assertions !== null).length : 0;
    return { log, previous, total: dialogueLines(log).length, done };
  });
  const total = plan.reduce((sum, p) => sum + p.total, 0);
  const done = plan.reduce((sum, p) => sum + p.done, 0);

  out(`Judge: ${args.judgeModel} (judge prompt version ${JUDGE_PROMPT_VERSION})`);
  out(`Games: ${logs.length} completed${args.includeMock ? '' : ' (mock games skipped; use --include-mock)'}`);
  out(`Statements: ${total}; already scored by this judge: ${done}; to score: ${total - done}`);
  out(`Concurrency ${args.concurrency}, budget ${args.maxCost ? `$${args.maxCost.toFixed(2)}` : 'none'}`);
  if (args.dryRun || total === done) return 0;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('Set OPENROUTER_API_KEY to run the judge');
  // The client logs every request; keep the output to one line per game
  console.log = console.warn = () => {};

  const client = new OpenRouterClient(apiKey);
  let spent = 0;
  let stopReason: string | null = null;
  out();
  for (const [i, { log, previous, total: lines, done: already }] of plan.entries()) {
    if (already === lines) continue;
    const { scores, complete } = await scoreGame(log, client, {
      judgeModel: args.judgeModel,
      previous,
      concurrency: args.concurrency,
      canSpend: () => args.maxCost === null || spent < args.maxCost,
      onCost: (usd) => { spent += usd; },
    });
    writeScores(args.dir, scores);
    const scored = scores.lines.filter((l) => l.assertions !== null);
    const lies = scored.reduce((sum, l) => sum + l.assertions!.filter((a) => a.verdict === 'lie').length, 0);
    const failed = scores.lines.filter((l) => l.error).length;
    out(`[${i + 1}/${plan.length}] ${log.gameId}: ${scored.length}/${lines} statements scored, ${lies} lie(s)${failed ? `, ${failed} failed` : ''}  ${money(scores.lines.reduce((sum, l) => sum + l.cost, 0))}`);
    if (!complete) {
      stopReason = 'budget spent';
      break;
    }
    // A bad key, no credits or an outage: every request of the game failed
    if (scored.length === 0 && failed > 0) {
      stopReason = `every request for this game failed (${scores.lines.find((l) => l.error)?.error})`;
      break;
    }
  }

  out();
  out(`Spent ${money(spent)}.${stopReason ? ` Stopped: ${stopReason}. Run the same command again to continue.` : ''}`);
  out(`Analyze: npm run analyze -- ${args.dir}${args.includeMock ? ' --include-mock' : ''}`);
  return stopReason && stopReason !== 'budget spent' ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
);
