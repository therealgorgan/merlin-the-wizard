import { tool } from 'ai';
import { z } from 'zod';
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

export const merlinTools = {
  add_task: tool({
    description:
      "Add a task to the user's persistent to-do list. " +
      'Use when the user says "remind me to X", "add X to my list", "I need to remember X", etc. ' +
      'Tasks survive across sessions.',
    parameters: z.object({
      title: z.string().describe('The task description, short and imperative (e.g., "buy milk")'),
    }),
    execute: async ({ title }) => {
      const t = await addTask(title);
      return { ok: true, id: t.id, title: t.title };
    },
  }),

  list_tasks: tool({
    description:
      'List the user\'s active (incomplete) tasks. Use when they ask "what\'s on my list", ' +
      '"what do I have to do", "show my todos", etc.',
    parameters: z.object({}).strict(),
    execute: async () => {
      const all = await listTasks({ includeCompleted: false });
      return {
        ok: true,
        count: all.length,
        tasks: all.map((t) => ({ id: t.id, title: t.title })),
      };
    },
  }),

  complete_task: tool({
    description:
      "Mark a task as done. Accepts either an exact task id from list_tasks or a title/keyword " +
      "to match (case-insensitive substring). Use when the user says 'I did X', 'cross off X', " +
      "'finished X', etc.",
    parameters: z.object({
      id_or_title: z
        .string()
        .describe('Either the task id (preferred) or a substring of the title to match'),
    }),
    execute: async ({ id_or_title }) => {
      const direct = await completeTask(id_or_title);
      if (direct) return { ok: true, by: 'id', match: id_or_title };
      const t = await findTaskByTitle(id_or_title);
      if (!t) return { ok: false, error: 'no matching task' };
      const ok = await completeTask(t.id);
      return { ok, by: 'title', match: t.title };
    },
  }),

  remove_task: tool({
    description:
      "Permanently delete a task from the list (different from completing it). Accepts id or title.",
    parameters: z.object({
      id_or_title: z.string().describe('Either the task id or a substring of the title'),
    }),
    execute: async ({ id_or_title }) => {
      const direct = await removeTask(id_or_title);
      if (direct) return { ok: true, by: 'id' };
      const t = await findTaskByTitle(id_or_title);
      if (!t) return { ok: false, error: 'no matching task' };
      const ok = await removeTask(t.id);
      return { ok, by: 'title', match: t.title };
    },
  }),

  move_to: tool({
    description:
      "Move Merlin's sprite smoothly to a screen corner or center. Use for " +
      "absolute repositioning: 'go to the top right', 'move to center', " +
      "'get out of the way' (pick a corner away from the user's focus).",
    parameters: z.object({
      corner: z
        .enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'])
        .describe('Which screen position to move to'),
    }),
    execute: async ({ corner }) => {
      const { x, y } = cornerCoords(corner);
      logger.info('move_to', corner, '->', x, y);
      await smoothMoveSpriteTo(x, y, 900);
      return { ok: true, corner };
    },
  }),

  move_relative: tool({
    description:
      "Slide Merlin a relative distance in a direction (left/right/up/down) " +
      "from his CURRENT position. Use for fuzzy positional commands: 'slide " +
      "left', 'scoot down a bit', 'move up', 'go right'. Pick 'small' for " +
      "subtle nudges (~100px), 'medium' for clear repositioning (~250px), " +
      "'large' for big sweeps (~500px). For named corners use move_to instead.",
    parameters: z.object({
      direction: z.enum(['left', 'right', 'up', 'down'])
        .describe('Which way to slide'),
      amount: z.enum(['small', 'medium', 'large']).optional()
        .describe('How far. Default medium.'),
    }),
    execute: async ({ direction, amount }) => {
      const { x, y } = relativeCoords(direction, amount ?? 'medium');
      logger.info('move_relative', direction, amount, '->', x, y);
      await smoothMoveSpriteTo(x, y, 900);
      return { ok: true, direction, amount: amount ?? 'medium' };
    },
  }),

  hide: tool({
    description:
      "Make Merlin disappear from the screen. Use when the user says 'go away', 'hide', " +
      "'leave me alone'. The user can bring you back from the tray menu.",
    parameters: z.object({}).strict(),
    execute: async () => {
      await hideMerlinWithAnimation();
      return { ok: true };
    },
  }),

  show: tool({
    description:
      "Make Merlin reappear after being hidden. Rarely needed since you're usually visible.",
    parameters: z.object({}).strict(),
    execute: async () => {
      await showMerlinWithAnimation();
      return { ok: true };
    },
  }),

  web_search: tool({
    description:
      "Search the live web for current information. Use for anything time-sensitive (news, " +
      "current events, recent releases, prices, today's weather, sports scores) or facts you're " +
      "not confident about. Don't use for things you already know or for simple opinions.",
    parameters: z.object({
      query: z.string().describe('A focused search query, like you would type into Google.'),
    }),
    execute: async ({ query }) => {
      const res = await webSearch(query);
      logger.info('web_search', query, '->', res.results.length, 'results via', res.engine);
      return res;
    },
  }),
};

export type MerlinTools = typeof merlinTools;
