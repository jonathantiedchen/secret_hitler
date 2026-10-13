// Reading a folder of game logs (only the folder itself: subfolders hold other data)

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameLog } from '../logging/gameLog.js';

export function loadLogs(dir: string): GameLog[] {
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
