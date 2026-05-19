import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import { listTasks } from '../tasks';
import { read as readStore } from '../storage/store';
import { getSecret } from '../storage/secrets';
import { logger } from '../logger';
import { ANIMATIONS } from '@shared/animations';
import type { BrainContext, BrainController } from './types';

// Hermes brain controller. Mirrors localLlmBrain but routes the decision call
// to a configured Hermes Agent endpoint (OpenAI-compatible chat completions
// API on ports 8642–8654 by convention). The schema, prompt, and gating are
// identical to local-llm so users can switch between them without surprises.

const TICK_MS = 5 * 60_000;
const TICK_TIMEOUT_MS = 45_000;
const IDLE_FLOOR_MS = 90_000;

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

export interface HermesBrainConfig {
  endpoint: string;
  model: string;
  temperature: number;
}

const DEFAULT_CONFIG: HermesBrainConfig = {
  endpoint: '',
  model: 'hermes-agent',
  temperature: 0.7,
};

async function loadConfig(): Promise<{ cfg: HermesBrainConfig; apiKey: string }> {
  const settings = await readStore();
  const stored = (settings.brainControllerConfig?.['hermes'] ?? {}) as Partial<HermesBrainConfig>;
  const endpoint = stored.endpoint?.trim() || settings.hermesEndpoint?.trim() || DEFAULT_CONFIG.endpoint;
  const model = stored.model?.trim() || DEFAULT_CONFIG.model;
  const temperature =
    typeof stored.temperature === 'number' ? stored.temperature : DEFAULT_CONFIG.temperature;
  const apiKey = (await getSecret('hermes_api_key')) ?? '';
  return { cfg: { endpoint, model, temperature }, apiKey };
}

async function buildPromptContext(ctx: BrainContext): Promise<string> {
  const tasks = await listTasks({ includeCompleted: false });
  const mood = await ctx.getMood();
  const energy = ctx.getEnergy();
  const tod = ctx.getTimeOfDay();
  const idleMs = ctx.msSinceLastInteraction();
  const taskLines = tasks.length
    ? tasks.slice(0, 5).map((t, i) => `  ${i + 1}. ${t.title}`).join('\n')
    : '  (none)';

  return [
    `Time of day: ${tod}`,
    `Mood: ${mood}`,
    `Energy: ${energy.toFixed(2)} (0=tired, 1=peppy)`,
    `Idle for: ${Math.round(idleMs / 1000)}s since last user interaction`,
    `displayMode: ${ctx.displayMode()}`,
    `sprite visible: ${ctx.spriteVisible()}, bubble: ${ctx.bubbleVisible()}, panel: ${ctx.panelVisible()}`,
    `User's open tasks:`,
    taskLines,
    `Allowed animations: ${SAFE_ANIMS.join(', ')}`,
  ].join('\n');
}

export function makeHermesBrain(): BrainController {
  let tickHandle: ReturnType<typeof setInterval> | null = null;
  let inflight = false;
  let lastTickAt = 0;
  let stopRequested = false;

  async function decide(ctx: BrainContext): Promise<BrainAction | null> {
    try {
      const { cfg, apiKey } = await loadConfig();
      if (!cfg.endpoint) {
        ctx.log('hermes brain: endpoint not configured — skipping');
        return null;
      }
      if (!apiKey) {
        ctx.log('hermes brain: API key missing — skipping');
        return null;
      }
      const client = createOpenAI({ apiKey, baseURL: cfg.endpoint });
      const model = client(cfg.model);
      const ctxBlock = await buildPromptContext(ctx);
      ctx.log(`hermes brain tick: endpoint=${cfg.endpoint} model=${cfg.model}`);

      return await Promise.race<BrainAction | null>([
        (async () => {
          const result = await generateObject({
            model,
            schema: ActionSchema,
            system: SYSTEM_PROMPT,
            prompt: ctxBlock,
            temperature: cfg.temperature,
          });
          return result.object;
        })(),
        new Promise<null>((resolve) =>
          setTimeout(() => {
            ctx.log(`hermes brain: timeout after ${TICK_TIMEOUT_MS}ms — skipping`);
            resolve(null);
          }, TICK_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log(`hermes brain: error (silent skip): ${msg}`);
      throw err;
    }
  }

  async function tick(ctx: BrainContext): Promise<void> {
    if (inflight || stopRequested) return;
    const intent = ctx.getIntent();
    if (intent === 'thinking' || intent === 'speaking' || intent === 'doing') return;
    if (ctx.msSinceLastInteraction() < IDLE_FLOOR_MS) return;
    const now = Date.now();
    if (now - lastTickAt < TICK_MS - 1000) return;
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

  async function forceTick(ctx: BrainContext): Promise<string> {
    if (inflight) return 'already running — try again in a moment';
    inflight = true;
    try {
      const action = await decide(ctx);
      if (!action) return 'no result — check endpoint + API key';
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
        ctx.log(`hermes brain: noop${action.reason ? ` — ${action.reason}` : ''}`);
        return;
      case 'idle_thought':
        ctx.log(`hermes brain: idle_thought "${action.text.slice(0, 60)}…"`);
        ctx.nudgeAttention();
        setTimeout(() => void ctx.emitIdleThought(action.text), 700);
        return;
      case 'wander':
        ctx.log(`hermes brain: wander`);
        await ctx.wanderRandom();
        return;
      case 'play_animation':
        ctx.log(`hermes brain: play_animation ${action.name}`);
        if ((ANIMATIONS as readonly string[]).includes(action.name)) {
          ctx.playAnimation(action.name as (typeof ANIMATIONS)[number]);
        }
        return;
      case 'nudge':
        ctx.log(`hermes brain: nudge`);
        ctx.nudgeAttention();
        return;
    }
  }

  return {
    id: 'hermes',
    start(ctx: BrainContext): void {
      if (tickHandle) return;
      stopRequested = false;
      const initialDelay = Math.min(TICK_MS, 2 * 60_000);
      setTimeout(() => {
        if (stopRequested) return;
        void tick(ctx);
        tickHandle = setInterval(() => void tick(ctx), TICK_MS);
      }, initialDelay);
      logger.info(
        `hermesBrain started (tick every ${TICK_MS / 1000}s, initial delay ${initialDelay / 1000}s)`,
      );
    },
    stop(): void {
      stopRequested = true;
      if (tickHandle) {
        clearInterval(tickHandle);
        tickHandle = null;
        logger.info('hermesBrain stopped');
      }
    },
    onUserInteraction(): void {
      lastTickAt = Date.now();
    },
    forceTick,
  };
}
