import { listTasks } from '../tasks';
import { logger } from '../logger';
import type { BrainContext, BrainController } from './types';

// Default brain controller — wraps the original timer-based logic that
// lived in `brain.ts` directly. Ticks every 60s; when the user has been
// idle, may emit an idle thought or trigger a wander.

const TICK_MS = 60_000;
const IDLE_AFTER_MS = 90_000;
const WANDER_CHANCE = 0.18;
const IDLE_THOUGHT_CHANCE = 0.12;
const IDLE_THOUGHT_MIN_GAP_MS = 5 * 60_000;

function timeOfDayHour(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = new Date().getHours();
  if (h < 5) return 'night';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 22) return 'evening';
  return 'night';
}

async function pickIdleThought(ctx: BrainContext): Promise<string | null> {
  const slot = timeOfDayHour();
  const tasks = await listTasks({ includeCompleted: false });
  const pool: string[] = [];

  if (slot === 'morning') {
    pool.push(
      'A fresh morning, traveler. Coffee brewed?',
      'Up early, are we? The day awaits.',
    );
  } else if (slot === 'afternoon') {
    pool.push(
      'Hope your afternoon is treating you kindly.',
      'The day marches on. Anything I can help with?',
    );
  } else if (slot === 'evening') {
    pool.push(
      'Evening already? Where does the time go.',
      'Winding down? Or just getting started?',
    );
  } else {
    pool.push(
      "It's late, friend. I'm here if you need me.",
      'Burning the midnight oil, I see.',
    );
  }

  if (tasks.length > 0) {
    const first = tasks[0]?.title ?? '';
    pool.push(
      `By the way — you still have "${first}" on your list. Just saying.`,
      `${tasks.length} task${tasks.length === 1 ? '' : 's'} remain on the parchment. No rush.`,
    );
  }

  pool.push(
    'A wise wizard once said... nothing. He was idle. Like me, just now.',
    "If you need anything, I'm right here.",
    'I was just remembering Office 97. Simpler times.',
  );

  ctx.log('pickIdleThought: chose from pool of', { size: pool.length });
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

export function makeDefaultBrain(): BrainController {
  let tickHandle: ReturnType<typeof setInterval> | null = null;
  let isActing = false;
  let lastThoughtAt = 0;

  async function maybeWander(ctx: BrainContext): Promise<void> {
    if (isActing) return;
    // Don't fight an in-flight chat / response.
    const intent = ctx.getIntent();
    if (intent === 'thinking' || intent === 'speaking' || intent === 'doing') return;
    isActing = true;
    try {
      logger.debug('defaultBrain: wandering');
      await ctx.wanderRandom();
    } finally {
      isActing = false;
    }
  }

  async function maybeIdleThought(ctx: BrainContext): Promise<void> {
    if (isActing) return;
    const intent = ctx.getIntent();
    if (intent === 'thinking' || intent === 'speaking' || intent === 'doing') return;
    const now = Date.now();
    if (now - lastThoughtAt < IDLE_THOUGHT_MIN_GAP_MS) return;
    const text = await pickIdleThought(ctx);
    if (!text) return;
    lastThoughtAt = now;
    ctx.nudgeAttention();
    setTimeout(() => void ctx.emitIdleThought(text), 700);
  }

  async function tick(ctx: BrainContext): Promise<void> {
    if (ctx.msSinceLastInteraction() < IDLE_AFTER_MS) return;
    if (Math.random() < IDLE_THOUGHT_CHANCE) {
      await maybeIdleThought(ctx);
      return;
    }
    if (Math.random() < WANDER_CHANCE) {
      await maybeWander(ctx);
    }
  }

  return {
    id: 'default',
    start(ctx: BrainContext): void {
      if (tickHandle) return;
      tickHandle = setInterval(() => void tick(ctx), TICK_MS);
      logger.info(
        'defaultBrain started (tick',
        TICK_MS / 1000,
        's, idle after',
        IDLE_AFTER_MS / 1000,
        's)',
      );
    },
    stop(): void {
      if (tickHandle) {
        clearInterval(tickHandle);
        tickHandle = null;
        logger.info('defaultBrain stopped');
      }
    },
  };
}
