import { getSecret } from './storage/secrets';
import { read as readStore, write as writeStore } from './storage/store';
import { logger } from './logger';

// Each Hermes profile runs its own gateway process with its own api_server
// port. There's no single "list all profiles" endpoint — we have to probe
// a port range on the configured host and ask each port who it is via
// /v1/models. Discovered profiles get cached in the store so the tray
// quick-switcher works even before opening Settings.

const DEFAULT_PORT_START = 8640;
const DEFAULT_PORT_END = 8670;
const PROBE_TIMEOUT_MS = 1500;

export interface HermesProfile {
  name: string;
  url: string;
}

function deriveHostBase(endpoint: string): string | null {
  try {
    const u = new URL(endpoint);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return null;
  }
}

async function probePort(host: string, port: number, key: string): Promise<HermesProfile | null> {
  const url = `${host}:${port}/v1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const id = data.data?.[0]?.id;
    if (!id) return null;
    return { name: id, url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe every port in [start..end] on the host derived from the configured
 * hermesEndpoint, then cache + return the discovered profiles.
 */
export async function discoverAllHermesProfiles(opts?: {
  start?: number;
  end?: number;
}): Promise<HermesProfile[]> {
  const settings = await readStore();
  const endpoint = settings.hermesEndpoint?.trim();
  if (!endpoint) throw new Error('Hermes endpoint not configured');
  const host = deriveHostBase(endpoint);
  if (!host) throw new Error('Cannot parse Hermes endpoint URL');
  const key = await getSecret('hermes_api_key');
  if (!key) throw new Error('Hermes API key not saved');

  const start = opts?.start ?? DEFAULT_PORT_START;
  const end = opts?.end ?? DEFAULT_PORT_END;

  const ports: number[] = [];
  for (let p = start; p <= end; p++) ports.push(p);

  const results = await Promise.all(ports.map((p) => probePort(host, p, key)));
  const profiles = results
    .filter((r): r is HermesProfile => r !== null)
    // Dedupe by name (some setups proxy the same profile on multiple ports)
    .filter((p, i, arr) => arr.findIndex((q) => q.name === p.name) === i)
    .sort((a, b) => a.name.localeCompare(b.name));

  logger.info('Hermes discovery:', profiles.length, 'profile(s) on', host, `[${start}..${end}]`);
  await writeStore({ hermesProfiles: profiles });
  return profiles;
}

export async function getCachedHermesProfiles(): Promise<HermesProfile[]> {
  const s = await readStore();
  return s.hermesProfiles ?? [];
}

export async function setActiveHermesProfile(profile: HermesProfile): Promise<void> {
  await writeStore({ hermesEndpoint: profile.url, llmModel: profile.name });
  logger.info('Hermes profile ->', profile.name, profile.url);
}
