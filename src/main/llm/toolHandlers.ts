import {
  addTask,
  completeTask,
  findTaskByTitle,
  listTasks,
  removeTask,
} from '../tasks';
import {
  cornerCoords,
  hideMerlinWithAnimation,
  relativeCoords,
  showMerlinWithAnimation,
  smoothMoveSpriteTo,
} from '../windows/spriteWindow';
import { webSearch } from '../tools/webSearch';
import { logger } from '../logger';

const VALID_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'] as const;
type Corner = (typeof VALID_CORNERS)[number];
const VALID_DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
type Direction = (typeof VALID_DIRECTIONS)[number];
const VALID_AMOUNTS = ['small', 'medium', 'large'] as const;
type Amount = (typeof VALID_AMOUNTS)[number];

function pickString(obj: unknown, key: string): string | undefined {
  if (typeof obj !== 'object' || obj === null) return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : undefined;
}

type Handler = (args: unknown) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  add_task: async (args) => {
    const title = pickString(args, 'title') ?? '';
    if (!title.trim()) return { ok: false, error: 'missing title' };
    const t = await addTask(title);
    return { ok: true, id: t.id, title: t.title };
  },

  list_tasks: async () => {
    const tasks = await listTasks({ includeCompleted: false });
    return {
      ok: true,
      count: tasks.length,
      tasks: tasks.map((t) => ({ id: t.id, title: t.title })),
    };
  },

  complete_task: async (args) => {
    const key = pickString(args, 'id_or_title') ?? pickString(args, 'title') ?? pickString(args, 'id') ?? '';
    if (!key) return { ok: false, error: 'missing id_or_title' };
    if (await completeTask(key)) return { ok: true, by: 'id' };
    const t = await findTaskByTitle(key);
    if (!t) return { ok: false, error: 'no matching task' };
    return { ok: await completeTask(t.id), by: 'title', match: t.title };
  },

  remove_task: async (args) => {
    const key = pickString(args, 'id_or_title') ?? pickString(args, 'title') ?? pickString(args, 'id') ?? '';
    if (!key) return { ok: false, error: 'missing id_or_title' };
    if (await removeTask(key)) return { ok: true, by: 'id' };
    const t = await findTaskByTitle(key);
    if (!t) return { ok: false, error: 'no matching task' };
    return { ok: await removeTask(t.id), by: 'title', match: t.title };
  },

  move_to: async (args) => {
    const c = pickString(args, 'corner') ?? '';
    if (!(VALID_CORNERS as readonly string[]).includes(c)) {
      return { ok: false, error: 'invalid corner', got: c };
    }
    const { x, y } = cornerCoords(c as Corner);
    logger.info('tool move_to', c, '->', x, y);
    await smoothMoveSpriteTo(x, y, 900);
    return { ok: true, corner: c };
  },

  move_relative: async (args) => {
    const d = pickString(args, 'direction') ?? '';
    const a = pickString(args, 'amount') ?? 'medium';
    if (!(VALID_DIRECTIONS as readonly string[]).includes(d)) {
      return { ok: false, error: 'invalid direction', got: d };
    }
    const amount: Amount = (VALID_AMOUNTS as readonly string[]).includes(a)
      ? (a as Amount) : 'medium';
    const { x, y } = relativeCoords(d as Direction, amount);
    logger.info('tool move_relative', d, amount, '->', x, y);
    await smoothMoveSpriteTo(x, y, 900);
    return { ok: true, direction: d, amount };
  },

  hide: async () => {
    await hideMerlinWithAnimation();
    return { ok: true };
  },

  show: async () => {
    await showMerlinWithAnimation();
    return { ok: true };
  },

  web_search: async (args) => {
    const query = pickString(args, 'query') ?? pickString(args, 'q') ?? '';
    if (!query.trim()) return { ok: false, error: 'missing query' };
    return webSearch(query);
  },
};

export async function executeToolByName(name: string, args: unknown): Promise<unknown> {
  const handler = handlers[name];
  if (!handler) {
    logger.warn('Unknown tool call:', name);
    return { ok: false, error: 'unknown tool' };
  }
  try {
    return await handler(args ?? {});
  } catch (err) {
    logger.error('Tool execution error:', name, err);
    return { ok: false, error: String(err) };
  }
}

export function getKnownToolNames(): string[] {
  return Object.keys(handlers);
}
