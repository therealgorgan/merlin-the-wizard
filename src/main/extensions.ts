import {
  EXTENSIONS_BY_KEY,
  EXTENSIONS_CATALOG,
  type ExtensionFlag,
} from '@shared/extensions-catalog';
import { read as readStore, write as writeStore } from './storage/store';
import { logger } from './logger';

// Module-level sync cache for feature-flag values. Reads from the store are
// async; gate sites (e.g. animation cycle ticks, drag deltas at 30Hz, eye
// tracking every 12-22s) can't afford an await on every check. We warm the
// cache once at boot, then sync-read here. `invalidateExtensionsCache()` is
// called from the `settingsSet` IPC dispatch whenever the `extensions` patch
// changes.

let cache: Record<string, boolean | string> | null = null;
let warmed = false;

/** Warm the cache. Call once at boot; subsequent settingsSet changes update
 *  it incrementally via invalidateExtensionsCache. */
export async function warmExtensionsCache(): Promise<void> {
  const data = await readStore();
  cache = { ...(data.extensions ?? {}) };
  // Migration: read legacy top-level boolean keys once and seed the new
  // extension keys if the user hasn't explicitly set them yet. Legacy keys
  // are LEFT in the store (zombie fields) so a downgrade to 0.3.x still
  // works. Removed in 0.6.0.
  let migrated = false;
  const legacy = data as unknown as Record<string, unknown>;
  for (const flag of EXTENSIONS_CATALOG) {
    if (flag.kind !== 'boolean' || !flag.legacyStoreKey) continue;
    if (cache[flag.key] !== undefined) continue; // user already set explicitly
    const legacyVal = legacy[flag.legacyStoreKey];
    if (typeof legacyVal === 'boolean') {
      cache[flag.key] = legacyVal;
      migrated = true;
    }
  }
  if (migrated) {
    logger.info('extensions: migrated', Object.keys(cache).length, 'legacy keys into extensions cache');
    // Persist so we don't re-migrate next boot.
    await writeStore({ extensions: cache });
  }
  warmed = true;
  logger.debug('extensions cache warm', { keys: Object.keys(cache).length });
}

/** Invalidate so the next access re-reads the store. Called when settingsSet
 *  receives an `extensions` patch. */
export function invalidateExtensionsCache(): void {
  cache = null;
  warmed = false;
}

function syncCache(): Record<string, boolean | string> {
  if (cache !== null) return cache;
  // Should only happen if a caller hits us before warmExtensionsCache resolved
  // — fall back to all-defaults until the warm finishes.
  if (!warmed) {
    logger.debug('extensions: hit sync path before warm; using defaults');
  }
  return {};
}

/** Whether a boolean flag is enabled. Defaults to `true` for unknown keys
 *  (philosophy: missing config means use the catalog default, which we make
 *  truthy for safety — if a check site references a flag we removed, the
 *  behavior keeps working). */
export function isEnabled(key: string): boolean {
  const c = syncCache();
  const stored = c[key];
  if (typeof stored === 'boolean') return stored;
  const flag = EXTENSIONS_BY_KEY[key];
  if (flag && flag.kind === 'boolean') return flag.default;
  return true;
}

/** Read the string value of a select-type flag. Defaults to the catalog
 *  default, or empty string if the key is unknown. */
export function getValue(key: string): string {
  const c = syncCache();
  const stored = c[key];
  if (typeof stored === 'string') return stored;
  const flag = EXTENSIONS_BY_KEY[key];
  if (flag && flag.kind === 'select') return flag.default;
  return '';
}

/** Map a `behavior.brain_controller.allow_override_actions` decision into
 *  the gate logic: if a brain controller wants to fire `action`, should we
 *  honor it even if the matching feature flag is off? */
export function isOverridable(): boolean {
  return isEnabled('behavior.brain_controller.allow_override_actions');
}

/** Snapshot for the renderer (e.g. spriteGetInitial payload) — merges store
 *  values with catalog defaults so renderer can apply CSS gates without
 *  needing the catalog itself at runtime. */
export function snapshotForRenderer(): Record<string, boolean | string> {
  const c = syncCache();
  const merged: Record<string, boolean | string> = {};
  for (const flag of EXTENSIONS_CATALOG) {
    merged[flag.key] = (c[flag.key] !== undefined ? c[flag.key]! : flag.default);
  }
  return merged;
}

export type { ExtensionFlag };
