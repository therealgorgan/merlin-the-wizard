import { createOllama } from 'ollama-ai-provider';
import { generateObject } from 'ai';
import { z } from 'zod';
import { listTasks } from '../tasks';
import { read as readStore } from '../storage/store';
import { logger } from '../logger';
import { ANIMATIONS } from '@shared/animations';
import type { BrainContext, BrainController } from './types';

// Local-LLM brain controller. On each tick (coarse cadence) we send a single
// generateObject call to a local Ollama-hosted model asking what Merlin
// should do next. The model picks one bounded action from a discriminated
// union — it cannot send arbitrary IPC, move Merlin off-screen, or invoke
// tools. Every action routes through the BrainContext methods which honor
// feature flags (unless behavior.brain_controller.allow_override_actions
// is on).

// Cadence: 5 minutes minimum between ticks, hard floor. Plus an in-flight
// mutex so overlapping calls never happen — if the previous tick is still
// waiting on the LLM the next tick is dropped silently.
const TICK_MS = 5 * 60_000;
const TICK_TIMEOUT_MS = 45_000;
const IDLE_FLOOR_MS = 90_000; // skip ticks while user is still actively interacting

// Conservative animation pool — same shortlist the default brain palette
// favors. Keeps the model from picking the 9-second Reading variant for a
// 4-second tick.
const SAFE_ANIMS = [
  'Pleased', 'Acknowledge', 'GestureUp', 'GestureLeft', 'GestureRight',
  'Idle1_1', 'Wave', 'LookUp', 'LookDown', 'Explain',
] as const;

const ActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('noop'),
    reason: z.string().max(120).optional(),
  }),
  z.object({
    action: z.literal('idle_thought'),
    text: z.string().min(2).max(280),
  }),
  z.object({
    action: z.literal('wander'),
  }),
  z.object({
    action: z.literal('play_animation'),
    name: z.enum(SAFE_ANIMS as unknown as [string, ...string[]]),
  }),
  z.object({
    action: z.literal('nudge'),
  }),
]);

type BrainAction = z.infer<typeof ActionSchema>;

const SYSTEM_PROMPT = `You are the autonomous brain of Merlin — a Microsoft Agent–style desktop companion.
Each call you make, you decide what Merlin should do RIGHT NOW given his state.
Pick ONE action. Most of the time the right answer is "noop" — Merlin shouldn't
be twitchy. Only emit an idle thought every several ticks at most.

Tone: warm, slightly old-fashioned, whimsical. Short. Never break character.
Never refer to yourself as an AI. Never produce more than 280 characters of
thought text.

Action menu:
- noop: do nothing this tick. Default choice.
- idle_thought: surface a short whimsical thought (≤140 chars ideal).
- wander: have Merlin drift to a new spot on screen.
- play_animation: play one named animation from the allowed list.
- nudge: small attention-getting wiggle.

Output ONLY the JSON object matching the schema.`;

export interface LocalLlmConfig {
  endpoint: string;
  model: string;
  temperature: number;
}

const DEFAULT_CONFIG: LocalLlmConfig = {
  endpoint: 'http://localhost:11434/api',
  model: 'llama3.2:3b',
  temperature: 0.8,
};

async function loadConfig(): Promise<LocalLlmConfig> {
  const settings = await readStore();
  const stored = (settings.brainControllerConfig?.['local-llm'] ?? {}) as Partial<LocalLlmConfig>;
  return {
    endpoint: stored.endpoint?.trim() || settings.ollamaEndpoint?.trim() || DEFAULT_CONFIG.endpoint,
    model: stored.model?.trim() || DEFAULT_CONFIG.model,
    temperature:
      typeof stored.temperature === 'number' ? stored.temperature : DEFAULT_CONFIG.temperature,
  };
}

async function buildPromptContext(ctx: BrainContext): Promise<string> {
  const tasks = await listTasks({ includeCompleted: false });
  const mood = await ctx.getMood();
  const energy = ctx.getEnergy();
  const tod = ctx.getTimeOfDay();
  const idleMs = ctx.msSinceLastInteraction();
  const surfaceLines = [
    `displayMode: ${ctx.displayMode()}`,
    `sprite visible: ${ctx.spriteVisible()}`,
    `bubble visible: ${ctx.bubbleVisible()}`,
    `panel visible: ${ctx.panelVisible()}`,
  ];
  const taskLines = tasks.length
    ? tasks.slice(0, 5).map((t, i) => `  ${i + 1}. ${t.title}`).join('\n')
    : '  (none)';

  return [
    `Time of day: ${tod}`,
    `Mood: ${mood}`,
    `Energy: ${energy.toFixed(2)} (0=tired, 1=peppy)`,
    `Idle for: ${Math.round(idleMs / 1000)}s since last user interaction`,
    `Surface state:`,
    ...surfaceLines.map((l) => `  ${l}`),
    `User's open tasks (truncated):`,
    taskLines,
    `Allowed animations: ${SAFE_ANIMS.join(', ')}`,
  ].join('\n');
}

export function makeLocalLlmBrain(): BrainController {
  let tickHandle: ReturnType<typeof setInterval> | null = null;
  let inflight = false;
  let lastTickAt = 0;
  let stopRequested = false;

  /** Inner decision call — shared by scheduled tick + forceTick. Returns
   *  the model's chosen action (or null on timeout / error). */
  async function decide(ctx: BrainContext): Promise<BrainAction | null> {
    try {
      const cfg = await loadConfig();
      const client = createOllama({ baseURL: cfg.endpoint });
      const model = client(cfg.model);
      const ctxBlock = await buildPromptContext(ctx);
      ctx.log(`local-llm brain tick: model=${cfg.model}`);

      return await Promise.race<BrainAction | null>([
        (async () => {
          const result = await generateObject({
            model,
            schema: ActionSchema,
            system: SYSTEM_PROMPT,
            prompt: ctxBlock,
            temperature: cfg.temperature,
            // Keep the model resident between ticks. Default Ollama keep-alive
            // is 5 min, our tick cadence is also 5 min — without this, every
            // other tick is a cold load.
            providerOptions: { ollama: { keepAlive: '15m' } },
          });
          return result.object;
        })(),
        new Promise<null>((resolve) =>
          setTimeout(() => {
            ctx.log(`local-llm brain: timeout after ${TICK_TIMEOUT_MS}ms — skipping tick`);
            resolve(null);
          }, TICK_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log(`local-llm brain: error (silent skip): ${msg}`);
      throw err;
    }
  }

  async function tick(ctx: BrainContext): Promise<void> {
    if (inflight || stopRequested) return;
    // Don't fight an in-flight chat. (User typing/Merlin speaking should win.)
    const intent = ctx.getIntent();
    if (intent === 'thinking' || intent === 'speaking' || intent === 'doing') return;
    if (ctx.msSinceLastInteraction() < IDLE_FLOOR_MS) return;
    const now = Date.now();
    if (now - lastTickAt < TICK_MS - 1000) return; // tight floor guards against setInterval skew
    lastTickAt = now;

    inflight = true;
    try {
      const action = await decide(ctx).catch(() => null);
      if (!action) return;
      await dispatchAction(ctx, action);
    } finally {
      inflight = false;
    }
  }

  /** On-demand decision. Bypasses idle-floor + intent gates. Returns a
   *  one-line summary of what the brain decided. Used by Settings →
   *  "Test brain now" so you can verify the LLM is reachable without
   *  waiting for the normal tick cadence. */
  async function forceTick(ctx: BrainContext): Promise<string> {
    if (inflight) return 'already running — try again in a moment';
    inflight = true;
    try {
      const action = await decide(ctx);
      if (!action) return 'timed out — model may be cold-loading; try again in 1–2 min';
      // Run the action for real so the user can see Merlin actually do it.
      await dispatchAction(ctx, action);
      switch (action.action) {
        case 'noop':
          return `noop${action.reason ? ` — ${action.reason}` : ''}`;
        case 'idle_thought':
          return `idle_thought: "${action.text}"`;
        case 'wander':
          return 'wander';
        case 'play_animation':
          return `play_animation: ${action.name}`;
        case 'nudge':
          return 'nudge';
      }
    } catch (err) {
      return `error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      inflight = false;
    }
  }

  async function dispatchAction(ctx: BrainContext, action: BrainAction): Promise<void> {
    switch (action.action) {
      case 'noop':
        ctx.log(`local-llm brain: noop${action.reason ? ` — ${action.reason}` : ''}`);
        return;
      case 'idle_thought':
        ctx.log(`local-llm brain: idle_thought "${action.text.slice(0, 60)}…"`);
        ctx.nudgeAttention();
        setTimeout(() => void ctx.emitIdleThought(action.text), 700);
        return;
      case 'wander':
        ctx.log(`local-llm brain: wander`);
        await ctx.wanderRandom();
        return;
      case 'play_animation':
        ctx.log(`local-llm brain: play_animation ${action.name}`);
        if ((ANIMATIONS as readonly string[]).includes(action.name)) {
          ctx.playAnimation(action.name as (typeof ANIMATIONS)[number]);
        }
        return;
      case 'nudge':
        ctx.log(`local-llm brain: nudge`);
        ctx.nudgeAttention();
        return;
    }
  }

  return {
    id: 'local-llm',
    start(ctx: BrainContext): void {
      if (tickHandle) return;
      stopRequested = false;
      // Run a first tick after a short delay so we don't hammer the model
      // immediately on boot (the user almost certainly isn't idle yet anyway).
      const initialDelay = Math.min(TICK_MS, 2 * 60_000);
      setTimeout(() => {
        if (stopRequested) return;
        void tick(ctx);
        tickHandle = setInterval(() => void tick(ctx), TICK_MS);
      }, initialDelay);
      logger.info(
        `localLlmBrain started (tick every ${TICK_MS / 1000}s, initial delay ${initialDelay / 1000}s)`,
      );
    },
    stop(): void {
      stopRequested = true;
      if (tickHandle) {
        clearInterval(tickHandle);
        tickHandle = null;
        logger.info('localLlmBrain stopped');
      }
    },
    onUserInteraction(): void {
      // Reset the cooldown so we don't tick immediately when the user goes
      // idle next — wait the full TICK_MS so they get peace and quiet.
      lastTickAt = Date.now();
    },
    forceTick,
  };
}
