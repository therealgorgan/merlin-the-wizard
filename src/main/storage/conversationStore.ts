import { app } from 'electron';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../logger';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const FILE_NAME = 'conversation.json';
const MAX_TURNS = 30;

let cache: ChatTurn[] | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function filePath(): string {
  return join(app.getPath('userData'), FILE_NAME);
}

export async function loadHistory(): Promise<ChatTurn[]> {
  if (cache) return cache.slice();
  try {
    const txt = await fsp.readFile(filePath(), 'utf-8');
    const data = JSON.parse(txt) as { history?: ChatTurn[] };
    cache = Array.isArray(data.history) ? data.history.slice(-MAX_TURNS) : [];
    logger.info('Loaded conversation history:', cache.length, 'turns');
  } catch {
    cache = [];
  }
  return cache.slice();
}

export async function appendTurn(turn: ChatTurn): Promise<void> {
  if (!cache) await loadHistory();
  cache!.push(turn);
  while (cache!.length > MAX_TURNS) cache!.shift();
  const snapshot = cache!.slice();
  writeQueue = writeQueue.then(async () => {
    try {
      await fsp.writeFile(
        filePath(),
        JSON.stringify({ history: snapshot }, null, 2),
        'utf-8',
      );
    } catch (err) {
      logger.error('conversation write failed', err);
    }
  });
  await writeQueue;
}

export async function clearHistory(): Promise<void> {
  cache = [];
  writeQueue = writeQueue.then(async () => {
    try {
      await fsp.writeFile(filePath(), JSON.stringify({ history: [] }, null, 2), 'utf-8');
    } catch (err) {
      logger.error('conversation clear failed', err);
    }
  });
  await writeQueue;
  logger.info('Conversation history cleared');
}

export function getHistorySnapshot(): ChatTurn[] {
  return cache ? cache.slice() : [];
}
