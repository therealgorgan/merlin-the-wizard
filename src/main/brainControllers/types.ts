import type { AnimationName } from '@shared/animations';
import type { Intent } from '../animationController';
import type { Mood } from '../feelings';
import type { TimeOfDay } from '../animationController';

// Capabilities exposed to brain controllers. Controllers don't touch sprite
// windows or animation internals directly — they call through this context
// so we can rate-limit, gate via feature flags, and swap implementations
// freely. All "acting" methods are flag-aware: silently no-op if the
// matching `behavior.*` flag is off (unless allow_override_actions is set).

export interface BrainContext {
  // ── Sensing ─────────────────────────────────────────────────────────────
  isIdle(): boolean;
  msSinceLastInteraction(): number;
  getIntent(): Intent;
  getEnergy(): number;
  getTimeOfDay(): TimeOfDay;
  getMood(): Promise<Mood>;
  listOpenTasks(): Promise<Array<{ id: string; title: string }>>;
  spriteVisible(): boolean;
  bubbleVisible(): boolean;
  panelVisible(): boolean;
  displayMode(): 'classic' | 'modern';

  // ── Acting ──────────────────────────────────────────────────────────────
  wanderRandom(): Promise<void>;
  emitIdleThought(text: string): Promise<void>;
  playAnimation(name: AnimationName): void;
  nudgeAttention(): void;
  log(message: string, meta?: unknown): void;
}

export interface BrainController {
  id: string;
  start(ctx: BrainContext): Promise<void> | void;
  stop(): Promise<void> | void;
  /** Optional: fired when the user submits a chat or otherwise interacts. */
  onUserInteraction?(): void;
  /** Optional: chat lifecycle hooks. */
  onTurnStart?(): void;
  onTurnComplete?(): void;
  /** Optional: user dismissed an idle thought we emitted. */
  onIdleThoughtDismissed?(id: string): void;
}

export interface BrainControllerFactory {
  id: string;
  displayName: string;
  description: string;
  configSchema?: ReadonlyArray<{
    key: string;
    type: 'string' | 'number' | 'boolean';
    label: string;
    default: unknown;
  }>;
  create(): BrainController;
}
