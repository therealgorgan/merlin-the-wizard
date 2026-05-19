import type { AnimationName } from '@shared/animations';
import type { Intent, TimeOfDay } from '../animationController';
import type { Mood } from '../feelings';
import type { BrainContext } from './types';

// Build a BrainContext singleton wired to the live modules. Controllers
// pass through here to act on the world. Async-import the implementation
// modules so we don't trigger circular imports at module-load time
// (brain → animationController → ... → brain).

import { getSpriteWindow, smoothMoveSpriteTo } from '../windows/spriteWindow';
import { getBubbleWindow, showBubble } from '../windows/bubbleWindow';
import {
  getChatPanelWindow,
  panelAddIdleThought,
} from '../windows/chatPanelWindow';
import { read as readStore } from '../storage/store';
import { listTasks } from '../tasks';
import { getMood } from '../feelings';
import { isEnabled, isOverridable } from '../extensions';
import { logger } from '../logger';
import { screen } from 'electron';

let lastInteractionMarkedAt = Date.now();

export function bumpInteractionMark(): void {
  lastInteractionMarkedAt = Date.now();
}

function getLastInteractionMark(): number {
  return lastInteractionMarkedAt;
}

const IDLE_THRESHOLD_MS = 90_000;

/** Build the BrainContext exposed to whichever controller is active. */
export function buildBrainContext(): BrainContext {
  return {
    // ── Sensing ──────────────────────────────────────────────────────────
    isIdle(): boolean {
      return Date.now() - getLastInteractionMark() >= IDLE_THRESHOLD_MS;
    },
    msSinceLastInteraction(): number {
      return Date.now() - getLastInteractionMark();
    },
    getIntent(): Intent {
      // Lazy require to avoid circular module-load (animationController
      // imports nothing brain-related at top level, but this keeps the
      // dependency graph clean either way).
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const mod = require('../animationController') as typeof import('../animationController');
      return mod.getIntent();
    },
    getEnergy(): number {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const mod = require('../animationController') as typeof import('../animationController');
      return mod.getEnergy();
    },
    getTimeOfDay(): TimeOfDay {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const mod = require('../animationController') as typeof import('../animationController');
      return mod.getTimeOfDay();
    },
    async getMood(): Promise<Mood> {
      return getMood();
    },
    async listOpenTasks(): Promise<Array<{ id: string; title: string }>> {
      const tasks = await listTasks({ includeCompleted: false });
      return tasks.map((t) => ({ id: t.id, title: t.title }));
    },
    spriteVisible(): boolean {
      const w = getSpriteWindow();
      return Boolean(w && w.isVisible());
    },
    bubbleVisible(): boolean {
      const w = getBubbleWindow();
      return Boolean(w && w.isVisible());
    },
    panelVisible(): boolean {
      const w = getChatPanelWindow();
      return Boolean(w && w.isVisible());
    },
    displayMode(): 'classic' | 'modern' {
      // Synchronous read — the cache in the store module is hot.
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const store = require('../storage/store') as typeof import('../storage/store');
      // The store's read() is async; fall back to 'classic' if we hit before
      // the cache is warm. In practice this is called on tick paths well
      // after boot — cache will be warm.
      // To stay sync, look at the unexported cache via JSON read if needed.
      // Cheaper: read displayMode from the renderer's perspective is rare.
      // For now, just await a quick read (we'll relax later if needed).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cachedAny = (store as any)._cache as { displayMode?: 'classic' | 'modern' } | undefined;
      if (cachedAny?.displayMode) return cachedAny.displayMode;
      return 'classic';
    },

    // ── Acting ───────────────────────────────────────────────────────────
    async wanderRandom(): Promise<void> {
      // Gate via feature flag unless the controller has been granted
      // override authority via behavior.brain_controller.allow_override_actions.
      if (!isEnabled('behavior.brain.wander') && !isOverridable()) return;
      const w = getSpriteWindow();
      if (!w || !w.isVisible()) return;
      const [sx, sy] = w.getPosition();
      const [sw, sh] = w.getSize();
      const display = screen.getDisplayMatching({
        x: sx ?? 0, y: sy ?? 0, width: sw ?? 0, height: sh ?? 0,
      });
      const wa = display.workArea;
      const dx = Math.round((Math.random() - 0.5) * 160);
      const dy = Math.round((Math.random() - 0.5) * 100);
      const targetX = Math.max(wa.x + 8, Math.min(wa.x + wa.width - (sw ?? 0) - 8, (sx ?? 0) + dx));
      const targetY = Math.max(wa.y + 8, Math.min(wa.y + wa.height - (sh ?? 0) - 8, (sy ?? 0) + dy));
      if (Math.abs(targetX - (sx ?? 0)) < 6 && Math.abs(targetY - (sy ?? 0)) < 6) return;
      await smoothMoveSpriteTo(targetX, targetY, 1200 + Math.random() * 800);
    },
    async emitIdleThought(text: string): Promise<void> {
      if (!isEnabled('behavior.brain.idle_thoughts') && !isOverridable()) return;
      const settings = await readStore();
      const sprite = getSpriteWindow();
      if (!sprite || !sprite.isVisible()) return;
      const id = `idle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (settings.displayMode === 'modern') {
        const panel = getChatPanelWindow();
        if (!panel || !panel.isVisible()) return;
        panelAddIdleThought({
          id,
          text,
          emittedAt: Date.now(),
          ttlMs: 120_000,
        });
      } else {
        const bubble = getBubbleWindow();
        if (bubble && bubble.isVisible()) return; // don't interrupt
        showBubble(text, { mode: 'read', durationMs: 9_000 });
      }
    },
    playAnimation(name: AnimationName): void {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const mod = require('../animationController') as typeof import('../animationController');
      mod.playInline(name);
    },
    nudgeAttention(): void {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const mod = require('../animationController') as typeof import('../animationController');
      mod.nudgeForIdleThought();
    },
    log(message: string, meta?: unknown): void {
      logger.debug(`[brain] ${message}`, meta ?? '');
    },
  };
}
