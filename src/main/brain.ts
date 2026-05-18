import { screen } from 'electron';
import {
  getSpriteWindow,
  smoothMoveSpriteTo,
} from './windows/spriteWindow';
import { getBubbleWindow, showBubble } from './windows/bubbleWindow';
import {
  getChatPanelWindow,
  panelAddIdleThought,
} from './windows/chatPanelWindow';
import { read as readStore } from './storage/store';
import { listTasks } from './tasks';
import { logger } from './logger';
import type { PanelIdleThought } from '@shared/ipc-contract';

// Merlin's autonomous behavior loop. Runs every TICK_MS and may decide to do
// something — wander, idle pose, etc. — when the user is NOT actively chatting.

const TICK_MS = 60_000; // 1 minute
const IDLE_AFTER_MS = 90_000; // last interaction must be older than this
const WANDER_CHANCE = 0.18; // probability per tick when idle
const IDLE_THOUGHT_CHANCE = 0.12; // ~once per ~8 idle ticks
const IDLE_THOUGHT_MIN_GAP_MS = 5 * 60_000; // never more than once per 5 min
let lastThoughtAt = 0;

let lastInteractionAt = Date.now();
let tickHandle: ReturnType<typeof setInterval> | null = null;
let isActing = false;

/** Marks the user as having interacted just now. Brain will hold off for a */
/** while afterward to avoid being annoying mid-chat. */
export function markInteraction(): void {
  lastInteractionAt = Date.now();
}

function isIdle(): boolean {
  return Date.now() - lastInteractionAt >= IDLE_AFTER_MS;
}

async function maybeWander(): Promise<void> {
  if (isActing) return;
  const w = getSpriteWindow();
  if (!w || !w.isVisible()) return;
  // If the bubble is showing, don't wander — bubble would have to chase.
  const bubble = getBubbleWindow();
  if (bubble && bubble.isVisible()) return;

  const [sx, sy] = w.getPosition();
  const [sw, sh] = w.getSize();
  const display = screen.getDisplayMatching({ x: sx ?? 0, y: sy ?? 0, width: sw ?? 0, height: sh ?? 0 });
  const wa = display.workArea;

  // Small drift — up to 80px in each axis, clamped to work area.
  const dx = Math.round((Math.random() - 0.5) * 160);
  const dy = Math.round((Math.random() - 0.5) * 100);
  const targetX = Math.max(wa.x + 8, Math.min(wa.x + wa.width - (sw ?? 0) - 8, (sx ?? 0) + dx));
  const targetY = Math.max(wa.y + 8, Math.min(wa.y + wa.height - (sh ?? 0) - 8, (sy ?? 0) + dy));

  if (Math.abs(targetX - (sx ?? 0)) < 6 && Math.abs(targetY - (sy ?? 0)) < 6) return;

  isActing = true;
  try {
    logger.debug('brain: wandering', { from: [sx, sy], to: [targetX, targetY] });
    await smoothMoveSpriteTo(targetX, targetY, 1200 + Math.random() * 800);
  } finally {
    isActing = false;
  }
}

function timeOfDay(d: Date): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = d.getHours();
  if (h < 5) return 'night';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 22) return 'evening';
  return 'night';
}

async function pickIdleThought(): Promise<string | null> {
  const now = new Date();
  const slot = timeOfDay(now);
  const tasks = await listTasks({ includeCompleted: false });

  const pool: string[] = [];

  // Time-based openers
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

  // Task-aware nudges
  if (tasks.length > 0) {
    const first = tasks[0]?.title ?? '';
    pool.push(
      `By the way — you still have "${first}" on your list. Just saying.`,
      `${tasks.length} task${tasks.length === 1 ? '' : 's'} remain on the parchment. No rush.`,
    );
  }

  // Generic asides
  pool.push(
    'A wise wizard once said... nothing. He was idle. Like me, just now.',
    "If you need anything, I'm right here.",
    "I was just remembering Office 97. Simpler times.",
  );

  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

// Modern-mode idle thoughts auto-expire in the chat panel after this TTL.
// 2 minutes is long enough to glance over, walk away briefly, come back and
// still engage with the thought before it disappears.
const PANEL_IDLE_THOUGHT_TTL_MS = 120_000;
let lastEmittedThoughtId: string | null = null;

async function maybeIdleThought(): Promise<void> {
  if (isActing) return;
  const now = Date.now();
  if (now - lastThoughtAt < IDLE_THOUGHT_MIN_GAP_MS) return;
  const settings = await readStore();
  if (!settings.idleThoughtsEnabled) return;
  const sprite = getSpriteWindow();
  if (!sprite || !sprite.isVisible()) return;
  const text = await pickIdleThought();
  if (!text) return;
  lastThoughtAt = now;
  // Route through the AnimationController so it knows we're temporarily
  // 'reacting' (prevents it from firing speaking-cycle gestures over the top).
  const { nudgeForIdleThought } = await import('./animationController');
  nudgeForIdleThought();

  if (settings.displayMode === 'modern') {
    // Modern mode: append a transient "thought" turn into the panel thread
    // with a visible countdown timer. The panel auto-removes when TTL
    // expires — no follow-up needed here. Skip if panel isn't visible yet.
    const panel = getChatPanelWindow();
    if (!panel || !panel.isVisible()) return;
    const thought: PanelIdleThought = {
      id: `idle-${now}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      emittedAt: now,
      ttlMs: PANEL_IDLE_THOUGHT_TTL_MS,
    };
    lastEmittedThoughtId = thought.id;
    logger.debug('brain: idle thought → panel', { id: thought.id });
    setTimeout(() => panelAddIdleThought(thought), 700);
    return;
  }

  // Classic mode: speech bubble. Skip if a bubble is already open.
  const bubble = getBubbleWindow();
  if (bubble && bubble.isVisible()) return;
  logger.debug('brain: idle thought → bubble');
  setTimeout(() => {
    showBubble(text, { mode: 'read', durationMs: 9_000 });
  }, 700);
}

/** Called from the panel-dismiss IPC. Ensures we don't immediately fire */
/** another thought after the user dismissed the previous one. The cooldown */
/** (IDLE_THOUGHT_MIN_GAP_MS) already enforces ~25 min between thoughts, */
/** so this hook is mostly a noop on the timing — but we use it to clear */
/** the in-flight thought ID so we know the user engaged. */
export function noteIdleThoughtDismissed(id: string): void {
  if (lastEmittedThoughtId === id) {
    lastEmittedThoughtId = null;
  }
}

async function tick(): Promise<void> {
  if (!isIdle()) return;
  if (Math.random() < IDLE_THOUGHT_CHANCE) {
    await maybeIdleThought();
    return;
  }
  if (Math.random() < WANDER_CHANCE) {
    await maybeWander();
  }
}

export function startBrain(): void {
  if (tickHandle) return;
  tickHandle = setInterval(() => {
    void tick();
  }, TICK_MS);
  logger.info('brain started (tick', TICK_MS / 1000, 's, idle after', IDLE_AFTER_MS / 1000, 's)');
}

export function stopBrain(): void {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}
