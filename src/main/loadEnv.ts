import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface LoadEnvResult {
  loaded: boolean;
  path: string;
  count: number;
  reason?: string;
}

/**
 * Load a .env file into process.env. Manual parser (process.loadEnvFile
 * silently fails in some Electron builds). Existing process.env values
 * are not overwritten.
 */
export function loadEnv(path: string): LoadEnvResult {
  const abs = resolve(path);
  if (!existsSync(abs)) return { loaded: false, path: abs, count: 0, reason: 'not found' };
  try {
    const content = readFileSync(abs, 'utf-8');
    let count = 0;
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && !(key in process.env)) {
        process.env[key] = value;
        count++;
      }
    }
    return { loaded: true, path: abs, count };
  } catch (err) {
    return { loaded: false, path: abs, count: 0, reason: String(err) };
  }
}

/**
 * Load .env from one of the likely project-root paths. Tries (in order):
 *   1. <__dirname>/../../.env   — bundled output: out/main/index.js -> project root
 *   2. process.cwd()/.env       — when launched from project root
 *   3. <__dirname>/../.env      — alt layouts
 */
export function loadProjectEnv(mainDir: string): LoadEnvResult {
  const candidates = [
    join(mainDir, '..', '..', '.env'),
    join(process.cwd(), '.env'),
    join(mainDir, '..', '.env'),
  ];
  for (const c of candidates) {
    const r = loadEnv(c);
    if (r.loaded) return r;
  }
  return { loaded: false, path: candidates.join(' | '), count: 0, reason: 'no .env found' };
}
