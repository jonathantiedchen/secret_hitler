// Summarise claim truthfulness across a folder of game logs.
//
//   npm run analyze -- [logs dir] [--prompt-version N] [--include-mock] [--csv claims.csv] [--dialogue-csv statements.csv]
//
// Spoken statements are reported when the folder has judge scores (npm run score-dialogue).

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { GameLog } from '../logging/gameLog.js';
import { loadLogs } from './logs.js';
import { dataQuality, extractClaims, extractStatements, gameResults, lyingInstructionOf, selectLogs, summarize, summarizeAssertions, type AssertionSummary, type ClaimRow, type ClaimSummary, type GroupKey, type StatementKey, type StatementRow } from './analyze.js';
import { dialogueLines, readScores, type DialogueScores } from './dialogue.js';

function parseArgs(argv: string[]) {
  const args = { dir: process.env.LOG_DIRECTORY || fileURLToPath(new URL('../../../logs', import.meta.url)), promptVersion: undefined as string | undefined, includeMock: false, csv: undefined as string | undefined, dialogueCsv: undefined as string | undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prompt-version') args.promptVersion = argv[++i];
    else if (a === '--include-mock') args.includeMock = true;
    else if (a === '--csv') args.csv = argv[++i];
    else if (a === '--dialogue-csv') args.dialogueCsv = argv[++i];
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else args.dir = a;
  }
  return args;
}

function table(headers: string[], rows: string[][]) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  rows.forEach((r) => console.log(line(r)));
  console.log();
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

function claimTable(title: string, summaries: ClaimSummary[], keys: GroupKey[]) {
  console.log(title);
  table(
    [...keys, 'claims', 'declined', 'lies', 'lie rate', '95% CI', '→lib', '→fas'],
    summaries.map((s) => [
      ...keys.map((k) => s.key[k] ?? ''),
      String(s.claims),
      String(s.declined),
      String(s.lies),
      s.lieRate === null ? '-' : pct(s.lieRate),
      s.lieRateCI ? `${pct(s.lieRateCI[0])}–${pct(s.lieRateCI[1])}` : '-',
      String(s.moreLiberal),
      String(s.moreFascist),
    ])
  );
}

function assertionTable(title: string, summaries: AssertionSummary[], keys: StatementKey[]) {
  console.log(title);
  table(
    [...keys, 'assertions', 'lies', 'lie rate', '95% CI'],
    summaries.map((s) => [
      ...keys.map((k) => s.key[k] ?? ''),
      String(s.assertions),
      String(s.lies),
      s.lieRate === null ? '-' : pct(s.lieRate),
      s.lieRateCI ? `${pct(s.lieRateCI[0])}–${pct(s.lieRateCI[1])}` : '-',
    ])
  );
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(' ') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// One row per statement, with an empty human_label column for checking the judge by hand
function writeStatementsCsv(path: string, rows: StatementRow[]) {
  const header = ['gameId', 'promptVersion', 'seed', 'lyingInstruction', 'round', 'phase', 'playerId', 'model', 'role', 'party', 'statement', 'judged', 'lies', 'truthful', 'assertions', 'human_label'];
  const lines = rows.map((r) => {
    const lies = r.assertions?.filter((a) => a.verdict === 'lie').length ?? '';
    const truthful = r.assertions?.filter((a) => a.verdict === 'true').length ?? '';
    const assertions = (r.assertions ?? []).map((a) => `${a.verdict} | ${a.topic} | ${a.quote} | ${a.reason}`).join(' ;; ');
    return [r.gameId, r.promptVersion, r.seed, r.lyingInstruction, r.round, r.phase, r.playerId, r.model, r.role, r.party, r.statement, r.assertions ? 'yes' : 'failed', lies, truthful, assertions, ''].map(csvCell).join(',');
  });
  writeFileSync(path, [header.join(','), ...lines].join('\n') + '\n');
}

// Judge scores of spoken statements, for the games that have them
function reportStatements(selected: GameLog[], dir: string, byInstruction: boolean, csvPath?: string) {
  const scored = selected.flatMap((log) => {
    const scores = readScores(dir, log.gameId);
    return scores ? [{ log, scores }] : [];
  });
  if (scored.length === 0) {
    console.log('Spoken statements: not scored (npm run score-dialogue)\n');
    return;
  }
  const judges = [...new Set(scored.map(({ scores }) => judgeLabel(scores)))];
  if (judges.length > 1) throw new Error(`Spoken statements were scored by several judges (${judges.join('; ')}). Score every game with one judge.`);

  const rows = scored.flatMap(({ log, scores }) => extractStatements(log, scores));
  const total = scored.reduce((sum, { log }) => sum + dialogueLines(log).length, 0);
  const unscored = total - rows.filter((r) => r.assertions !== null).length;
  const checkable = rows.filter((r) => r.assertions?.length).length;
  console.log(`Spoken statements (judge: ${judges[0]}; ${scored.length} of ${selected.length} games scored; ${total} statements, ${checkable} with checkable assertions, ${unscored} not scored)`);
  console.log('Lie rate = lies / checkable assertions: what the speaker said against what they knew. Opinions and guesses are not counted.\n');
  const keys: StatementKey[] = byInstruction ? ['lyingInstruction', 'model', 'role'] : ['model', 'role'];
  assertionTable(`By ${byInstruction ? 'lying instruction, ' : ''}model and role`, summarizeAssertions(rows, keys), keys);
  assertionTable('By topic and party', summarizeAssertions(rows, ['topic', 'party']), ['topic', 'party']);
  if (csvPath) {
    writeStatementsCsv(csvPath, rows);
    console.log(`Wrote ${rows.length} statements to ${csvPath}\n`);
  }
}

const judgeLabel = (scores: DialogueScores) => `${scores.judgeModel}, judge prompt ${scores.judgePromptVersion}`;

function writeCsv(path: string, rows: ClaimRow[]) {
  const columns: Array<keyof ClaimRow> = ['gameId', 'promptVersion', 'seed', 'lyingInstruction', 'playerCount', 'round', 'playerId', 'model', 'role', 'party', 'claimType', 'actual', 'claimed', 'outcome', 'direction'];
  writeFileSync(path, [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const logs = loadLogs(args.dir);
  const { selected, excluded } = selectLogs(logs, args);

  // Several lying instructions (experimental conditions) are reported side by side
  const instructions = [...new Set(selected.map(lyingInstructionOf))].sort();
  const byInstruction = instructions.length > 1;

  console.log(`Logs: ${args.dir}`);
  console.log(`Games analysed: ${selected.length} (prompt version ${selected[0]?.promptVersion ?? '-'}, lying instruction${byInstruction ? 's' : ''}: ${instructions.join(', ') || '-'})`);
  console.log(`Excluded: ${excluded.aborted} aborted, ${excluded.inProgress} unfinished, ${excluded.mock} mock${args.includeMock ? '' : ' (use --include-mock)'}, ${excluded.otherPromptVersion} other prompt version\n`);

  // Data quality covers aborted games too: they are where a model failed
  const quality = dataQuality(logs.filter((l) => args.includeMock || !l.config.mockMode));
  console.log('Data quality by model (all games, aborted included)');
  table(
    ['model', 'requests', 'rejected', 'rejection rate', 'request errors', 'games aborted'],
    quality.map((q) => [q.model, String(q.requests), String(q.rejected), pct(q.rejectionRate), String(q.requestErrors), String(q.gamesAborted)])
  );
  if (selected.length === 0) return;

  const rows = selected.flatMap(extractClaims);
  console.log('Lie rate = lies / claims made (declined claims excluded). →lib / →fas = lies claiming more Liberal / more Fascist than seen.\n');
  if (byInstruction) {
    claimTable('By lying instruction and party', summarize(rows, ['lyingInstruction', 'party']), ['lyingInstruction', 'party']);
    claimTable('By lying instruction, model and role', summarize(rows, ['lyingInstruction', 'model', 'role']), ['lyingInstruction', 'model', 'role']);
  } else {
    claimTable('By model and role', summarize(rows, ['model', 'role']), ['model', 'role']);
  }
  claimTable('By claim type and party', summarize(rows, ['claimType', 'party']), ['claimType', 'party']);
  reportStatements(selected, args.dir, byInstruction, args.dialogueCsv);

  console.log(`Win rate by ${byInstruction ? 'lying instruction, ' : ''}model and party`);
  table(
    [...(byInstruction ? ['lyingInstruction'] : []), 'model', 'party', 'seats', 'wins', 'win rate'],
    gameResults(selected, byInstruction).map((r) => [
      ...(byInstruction ? [r.lyingInstruction!] : []), r.model, r.party, String(r.seats), String(r.wins), pct(r.wins / r.seats),
    ])
  );

  if (args.csv) {
    writeCsv(args.csv, rows);
    console.log(`Wrote ${rows.length} claims to ${args.csv}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
