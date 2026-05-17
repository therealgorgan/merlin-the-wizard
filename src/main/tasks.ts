import { app } from 'electron';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger';

export interface Task {
  id: string;
  title: string;
  createdAt: number;
  completedAt: number | null;
}

const FILE_NAME = 'tasks.json';

let cache: Task[] | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let onChangeCallbacks: Array<() => void> = [];

function filePath(): string {
  return join(app.getPath('userData'), FILE_NAME);
}

function uid(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function load(): Promise<Task[]> {
  if (cache) return cache;
  try {
    const txt = await fsp.readFile(filePath(), 'utf-8');
    const data = JSON.parse(txt) as { tasks?: Task[] };
    cache = Array.isArray(data.tasks) ? data.tasks : [];
  } catch {
    cache = [];
  }
  return cache;
}

function persist(): void {
  const snapshot = (cache ?? []).slice();
  writeQueue = writeQueue.then(async () => {
    try {
      await fsp.writeFile(
        filePath(),
        JSON.stringify({ tasks: snapshot }, null, 2),
        'utf-8',
      );
    } catch (err) {
      logger.error('tasks write failed', err);
    }
  });
}

function fire(): void {
  for (const cb of onChangeCallbacks) cb();
}

export function setOnTasksChange(cb: () => void): () => void {
  onChangeCallbacks.push(cb);
  return () => {
    onChangeCallbacks = onChangeCallbacks.filter((c) => c !== cb);
  };
}

export async function listTasks(opts: { includeCompleted?: boolean } = {}): Promise<Task[]> {
  const all = await load();
  if (opts.includeCompleted) return all.slice();
  return all.filter((t) => t.completedAt === null);
}

export async function addTask(title: string): Promise<Task> {
  const all = await load();
  const task: Task = {
    id: uid(),
    title: title.trim(),
    createdAt: Date.now(),
    completedAt: null,
  };
  all.push(task);
  cache = all;
  persist();
  fire();
  logger.info('task added:', task.title);
  return task;
}

export async function completeTask(id: string): Promise<boolean> {
  const all = await load();
  const t = all.find((x) => x.id === id);
  if (!t || t.completedAt !== null) return false;
  t.completedAt = Date.now();
  persist();
  fire();
  logger.info('task completed:', t.title);
  return true;
}

export async function removeTask(id: string): Promise<boolean> {
  const all = await load();
  const idx = all.findIndex((x) => x.id === id);
  if (idx === -1) return false;
  const [removed] = all.splice(idx, 1);
  cache = all;
  persist();
  fire();
  logger.info('task removed:', removed?.title);
  return true;
}

export async function findTaskByTitle(title: string): Promise<Task | null> {
  const all = await load();
  const lower = title.toLowerCase().trim();
  // Exact match first, then substring.
  const exact = all.find((t) => t.title.toLowerCase() === lower && t.completedAt === null);
  if (exact) return exact;
  return all.find((t) => t.title.toLowerCase().includes(lower) && t.completedAt === null) ?? null;
}
