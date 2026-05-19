import { read as readStore } from './storage/store';
import { logger } from './logger';
import { buildBrainContext, bumpInteractionMark } from './brainControllers/context';
import { BRAIN_CONTROLLERS, getBrainFactory } from './brainControllers/registry';
import type { BrainContext, BrainController } from './brainControllers/types';

// Holds the active brain controller and the singleton BrainContext. The
// `brain.ts` shim re-exports `markInteraction` from here so chat lifecycle
// + IPC handlers don't need to know which controller is active. Swappable
// at runtime — settingsSet's `brainController` side-effect dispatches to
// swapBrain().

let current: BrainController | null = null;
let ctx: BrainContext | null = null;
const dismissedThoughtIds: Set<string> = new Set();

async function instantiate(id: string): Promise<BrainController> {
  const factory = getBrainFactory(id);
  if (!factory) {
    logger.warn(`brainSupervisor: unknown controller "${id}", falling back to 'default'`);
    return BRAIN_CONTROLLERS.default!.create();
  }
  return factory.create();
}

export async function startActiveBrain(): Promise<void> {
  if (current) {
    logger.debug('brainSupervisor.startActiveBrain: already started, ignoring');
    return;
  }
  if (!ctx) ctx = buildBrainContext();
  const settings = await readStore();
  const id = settings.brainController || 'default';
  current = await instantiate(id);
  logger.info(`brainSupervisor: starting controller "${id}"`);
  await current.start(ctx);
}

export async function stopActiveBrain(): Promise<void> {
  if (!current) return;
  try {
    await current.stop();
  } catch (err) {
    logger.warn('brainSupervisor: stop threw', err);
  }
  current = null;
}

/** Hot-swap the brain controller. Reads the latest `brainController` value
 *  from the store and switches to that. Safe to call when no controller is
 *  active (acts like startActiveBrain). */
export async function swapBrain(): Promise<void> {
  await stopActiveBrain();
  await startActiveBrain();
}

// ── Compat surface (re-exported from brain.ts for back-compat) ─────────────

/** Mark "user just did something". Used by chat lifecycle + IPC handlers to
 *  reset the idle countdown and notify the active controller. */
export function markInteraction(): void {
  bumpInteractionMark();
  current?.onUserInteraction?.();
}

/** Notify supervisor that an idle thought was dismissed (user clicked × or
 *  it auto-expired). The active controller can use this to update its own
 *  state (e.g. avoid re-emitting the same idea). */
export function noteIdleThoughtDismissed(id: string): void {
  dismissedThoughtIds.add(id);
  current?.onIdleThoughtDismissed?.(id);
}
