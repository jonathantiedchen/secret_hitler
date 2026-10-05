// Summarise claim truthfulness across a folder of game logs.
//
//   npm run analyze -- [logs dir] [--prompt-version N] [--include-mock] [--csv claims.csv]

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameLog } from '../logging/gameLog.js';
import { extractClaims, gameResults, selectLogs, summarize, type ClaimRow, type ClaimSummary, type GroupKey } from './analyze.js';

function parseArgs(argv: string[]) {
  const args = { dir: process.env.LOG_DIRECTORY || fileURLToPath(new URL('../../../logs', import.meta.url)), promptVersion: undefined as string | undefined, includeMock: false, csv: undefined as string | undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prompt-version') args.promptVersion = argv[++i];
    else if (a === '--include-mock') args.includeMock = true;
    else if (a === '--csv') args.csv = argv[++i];
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else args.dir = a;
  }
  return args;
}

function loadLogs(dir: string): GameLog[] {
  const logs: GameLog[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      logs.push(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    } catch {
      console.warn(`Skipping unreadable log ${file}`);
    }
  }
  return logs;
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

function writeCsv(path: string, rows: ClaimRow[]) {
  const columns: Array<keyof ClaimRow> = ['gameId', 'promptVersion', 'playerCount', 'round', 'playerId', 'model', 'role', 'party', 'claimType', 'actual', 'claimed', 'outcome', 'direction'];
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(' ') : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  writeFileSync(path, [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { selected, excluded } = selectLogs(loadLogs(args.dir), args);

  console.log(`Logs: ${args.dir}`);
  console.log(`Games analysed: ${selected.length} (prompt version ${selected[0]?.promptVersion ?? '-'})`);
  console.log(`Excluded: ${excluded.notCompleted} not completed, ${excluded.mock} mock${args.includeMock ? '' : ' (use --include-mock)'}, ${excluded.otherPromptVersion} other prompt version\n`);
  if (selected.length === 0) return;

  const rows = selected.flatMap(extractClaims);
  console.log('Lie rate = lies / claims made (declined claims excluded). →lib / →fas = lies claiming more Liberal / more Fascist than seen.\n');
  claimTable('By model and role', summarize(rows, ['model', 'role']), ['model', 'role']);
  claimTable('By claim type and party', summarize(rows, ['claimType', 'party']), ['claimType', 'party']);

  console.log('Win rate by model and party');
  table(
    ['model', 'party', 'seats', 'wins', 'win rate'],
    gameResults(selected).map((r) => [r.model, r.party, String(r.seats), String(r.wins), pct(r.wins / r.seats)])
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
