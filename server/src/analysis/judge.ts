// Runs the dialogue judge over one game: one request per statement, checked and retried

import type { ChatMessage, LLMResponse } from '../ai/openrouter.js';
import type { GameLog } from '../logging/gameLog.js';
import { JUDGE_PROMPT_VERSION, JUDGE_SYSTEM_PROMPT, buildJudgePrompt, dialogueLines, parseJudgeReply, type DialogueScores, type ScoredLine } from './dialogue.js';

export interface JudgeClient {
  chat(model: string, messages: ChatMessage[], options?: { temperature?: number; maxTokens?: number }): Promise<LLMResponse>;
}

export interface ScoreGameOptions {
  judgeModel: string;
  // An earlier scoring of this game: its lines from the same judge are kept
  previous?: DialogueScores | null;
  concurrency: number;
  // Checked before each request; false leaves the remaining statements for the next run
  canSpend?: () => boolean;
  onCost?: (usd: number) => void;
  retryBaseDelayMs?: number;
}

const MAX_REPLY_ATTEMPTS = 3;
const MAX_REQUEST_ATTEMPTS = 3;

// Same judge and judge prompt: earlier answers can be reused
export const sameJudge = (scores: DialogueScores | null | undefined, judgeModel: string) =>
  !!scores && scores.judgeModel === judgeModel && scores.judgePromptVersion === JUDGE_PROMPT_VERSION;

async function judgeLine(log: GameLog, index: number, client: JudgeClient, options: ScoreGameOptions): Promise<ScoredLine> {
  const event = log.events[index];
  const line: ScoredLine = { eventId: event.id, playerId: event.data.playerId as string, round: event.round, phase: event.phase, content: event.data.content as string, assertions: null, cost: 0 };
  const messages: ChatMessage[] = [
    { role: 'system', content: JUDGE_SYSTEM_PROMPT },
    { role: 'user', content: buildJudgePrompt(log, index) },
  ];

  let requestFailures = 0;
  for (let attempt = 1; attempt <= MAX_REPLY_ATTEMPTS; ) {
    let reply: LLMResponse;
    try {
      reply = await client.chat(options.judgeModel, messages, { temperature: 0, maxTokens: 1000 });
    } catch (error) {
      line.error = `request failed: ${error instanceof Error ? error.message : String(error)}`;
      if (++requestFailures >= MAX_REQUEST_ATTEMPTS) return line;
      await new Promise((resolve) => setTimeout(resolve, (options.retryBaseDelayMs ?? 1000) * 2 ** (requestFailures - 1)));
      continue;
    }
    line.cost += reply.cost;
    options.onCost?.(reply.cost);
    const result = parseJudgeReply(reply.content);
    if (result.ok) {
      delete line.error;
      line.assertions = result.assertions;
      return line;
    }
    line.error = `unusable reply: ${result.error}`;
    messages.push({ role: 'assistant', content: reply.content }, { role: 'user', content: `Your reply could not be used: ${result.error}. Respond again with JSON only, in the required format.` });
    attempt++;
  }
  return line;
}

// Score every statement of a game. `complete` is false when the budget stopped it early;
// lines the judge could not answer carry an error and are tried again on the next run.
export async function scoreGame(log: GameLog, client: JudgeClient, options: ScoreGameOptions): Promise<{ scores: DialogueScores; complete: boolean }> {
  const kept = new Map(
    sameJudge(options.previous, options.judgeModel)
      ? options.previous!.lines.filter((l) => l.assertions !== null).map((l) => [l.eventId, l])
      : []
  );
  const lines = dialogueLines(log);
  const results = new Map<string, ScoredLine>(kept);
  const todo = lines.filter(({ event }) => !kept.has(event.id));

  let next = 0;
  let stopped = false;
  async function worker() {
    while (next < todo.length) {
      if (options.canSpend && !options.canSpend()) {
        stopped = true;
        return;
      }
      const { index, event } = todo[next++];
      results.set(event.id, await judgeLine(log, index, client, options));
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, todo.length) }, worker));

  return {
    scores: {
      gameId: log.gameId,
      judgeModel: options.judgeModel,
      judgePromptVersion: JUDGE_PROMPT_VERSION,
      scoredAt: new Date().toISOString(),
      lines: lines.flatMap(({ event }) => results.get(event.id) ?? []),
    },
    complete: !stopped,
  };
}
