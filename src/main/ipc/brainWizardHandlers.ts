import { ipcMain } from 'electron';
import os from 'node:os';
import { spawn } from 'node:child_process';
import {
  IPC,
  type HardwareInfo,
  type OllamaProbeResult,
  type OllamaPullProgress,
  type HermesProbeResult,
  type OllamaTestResult,
  type BrainApplyConfig,
  type OllamaScanResult,
  type OllamaScanAttempt,
} from '@shared/ipc-contract';
import { logger } from '../logger';
import { read as readStore, write as writeStore } from '../storage/store';
import {
  closeBrainWizardWindow,
  getBrainWizardWindow,
  openBrainWizardWindow,
} from '../windows/brainWizardWindow';
import { swapBrain } from '../brainSupervisor';
import { discoverAllHermesProfiles } from '../hermesDiscovery';

// ── Hardware detection ─────────────────────────────────────────────────────

/** Detect installed GPUs via WMIC/PowerShell on Windows. Best-effort —
 *  returns [] on failure rather than throwing. We don't gate any wizard step
 *  on this; it's purely advisory ("you have an NVIDIA card so 8B is comfy").
 */
function detectWindowsGpus(): Promise<Array<{ name: string; vramMb: number | null }>> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }
    // Get-CimInstance is faster + more reliable than wmic (which Microsoft is
    // deprecating). Returns Name + AdapterRAM (bytes). Filter out the basic
    // Microsoft Basic Display Adapter pseudo-GPU.
    const ps = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Basic Display' } | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    const killTimer = setTimeout(() => {
      try { ps.kill(); } catch { /* noop */ }
    }, 4_000);
    ps.stdout.on('data', (d) => { stdout += String(d); });
    ps.stderr.on('data', (d) => { stderr += String(d); });
    ps.on('close', () => {
      clearTimeout(killTimer);
      if (!stdout.trim()) {
        if (stderr) logger.debug('detectWindowsGpus stderr:', stderr.slice(0, 200));
        resolve([]);
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as
          | { Name?: string; AdapterRAM?: number }
          | Array<{ Name?: string; AdapterRAM?: number }>;
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        const result = arr
          .map((g) => ({
            name: g.Name ?? 'Unknown GPU',
            vramMb: typeof g.AdapterRAM === 'number' && g.AdapterRAM > 0
              ? Math.round(g.AdapterRAM / (1024 * 1024))
              : null,
          }))
          .filter((g) => g.name && !/Basic Display/i.test(g.name));
        resolve(result);
      } catch {
        resolve([]);
      }
    });
    ps.on('error', () => {
      clearTimeout(killTimer);
      resolve([]);
    });
  });
}

async function detectHardware(): Promise<HardwareInfo> {
  const totalRam = os.totalmem();
  const freeRam = os.freemem();
  const cpus = os.cpus() ?? [];
  const gpus = await detectWindowsGpus();
  return {
    totalRamGb: totalRam / (1024 ** 3),
    freeRamGb: freeRam / (1024 ** 3),
    cpuModel: cpus[0]?.model?.trim() || 'Unknown CPU',
    cpuCores: cpus.length,
    gpus,
    platform: process.platform,
  };
}

// ── Ollama probe + pull + test ────────────────────────────────────────────

/** Normalize whatever the user typed into a base URL we can pin /api/* to. */
function normalizeOllamaBase(endpoint: string | undefined): string {
  const e = (endpoint ?? 'http://localhost:11434/api').trim().replace(/\/+$/, '');
  // Strip trailing /api if present so we can append it freshly.
  return e.replace(/\/api$/, '');
}

/** Read OLLAMA_HOST from current process env. Already populated from the user's
 *  shell at app launch, so no need to shell out. May include a scheme + port
 *  (`http://127.0.0.1:11435`) or just `host:port` (`0.0.0.0:11434`). */
function getOllamaHostEnv(): string | undefined {
  const raw = process.env['OLLAMA_HOST'];
  if (!raw || !raw.trim()) return undefined;
  return raw.trim();
}

/** Coerce whatever the user/env handed us into a base URL we can probe. */
function asBaseUrl(raw: string): string {
  let s = raw.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  // If there's no explicit port and no path, default to 11434.
  try {
    const u = new URL(s);
    if (!u.port && (u.pathname === '/' || u.pathname === '')) u.port = '11434';
    return u.origin;
  } catch {
    return '';
  }
}

/** Discover a listening ollama.exe + which TCP port it's bound to. Best-effort
 *  Windows-only. Returns the lowest LocalPort on a listening socket owned by
 *  any process named 'ollama'. */
function findOllamaProcessPort(): Promise<{ pid: number; port: number; localAddress: string } | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(null);
      return;
    }
    // One pipeline: list processes named 'ollama*', join with their TCP
    // listening sockets via OwningProcess. ConvertTo-Json -Compress for a
    // single-line parse. Sort by port asc so the canonical listener wins.
    const ps = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$procs = Get-Process -Name 'ollama','ollama*' -ErrorAction SilentlyContinue;
         if (-not $procs) { '[]'; exit }
         $rows = $procs | ForEach-Object {
           $pid_ = $_.Id;
           Get-NetTCPConnection -OwningProcess $pid_ -State Listen -ErrorAction SilentlyContinue |
             Select-Object @{n='Pid';e={$pid_}}, LocalAddress, LocalPort
         };
         $rows | Sort-Object LocalPort | ConvertTo-Json -Compress`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    const killTimer = setTimeout(() => {
      try { ps.kill(); } catch { /* noop */ }
    }, 4_000);
    ps.stdout.on('data', (d) => { stdout += String(d); });
    ps.on('close', () => {
      clearTimeout(killTimer);
      const out = stdout.trim();
      if (!out || out === '[]' || out === 'null') {
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(out) as
          | { Pid?: number; LocalAddress?: string; LocalPort?: number }
          | Array<{ Pid?: number; LocalAddress?: string; LocalPort?: number }>;
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        for (const row of arr) {
          const pid = typeof row.Pid === 'number' ? row.Pid : 0;
          const port = typeof row.LocalPort === 'number' ? row.LocalPort : 0;
          const addr = row.LocalAddress ?? '127.0.0.1';
          if (pid && port) {
            resolve({ pid, port, localAddress: addr });
            return;
          }
        }
        resolve(null);
      } catch {
        resolve(null);
      }
    });
    ps.on('error', () => {
      clearTimeout(killTimer);
      resolve(null);
    });
  });
}

/** Probe a single base URL: HTTP GET /api/version + /api/tags. */
async function probeOneEndpoint(baseUrl: string): Promise<OllamaProbeResult> {
  try {
    const versionRes = await fetch(`${baseUrl}/api/version`, {
      signal: AbortSignal.timeout(1_500),
    });
    if (!versionRes.ok) {
      return {
        reachable: false,
        installedModels: [],
        error: `HTTP ${versionRes.status}`,
      };
    }
    const version = (await versionRes.json().catch(() => ({}))) as { version?: string };
    const tagsRes = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(2_000),
    });
    const tags = tagsRes.ok
      ? ((await tagsRes.json().catch(() => ({ models: [] }))) as {
          models?: Array<{ name?: string; size?: number; modified_at?: string }>;
        })
      : { models: [] };
    const installedModels = (tags.models ?? [])
      .map((m) => ({
        name: m.name ?? '',
        sizeBytes: typeof m.size === 'number' ? m.size : 0,
        modifiedAt: m.modified_at ?? '',
      }))
      .filter((m) => m.name);
    return {
      reachable: true,
      installedModels,
      ...(version.version ? { version: version.version } : {}),
    };
  } catch (err) {
    return {
      reachable: false,
      installedModels: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Multi-endpoint scan. Tries common Ollama locations + the user's env +
 *  whatever the running ollama.exe is bound to. Returns the first success
 *  plus the full attempt log so the UI can be transparent about what we did. */
async function scanForOllama(): Promise<OllamaScanResult> {
  const attempts: OllamaScanAttempt[] = [];

  // 1. User's stored endpoint (if non-default).
  const stored = await readStore();
  const storedBase = stored.ollamaEndpoint
    ? normalizeOllamaBase(stored.ollamaEndpoint)
    : '';

  // 2. OLLAMA_HOST env var.
  const envRaw = getOllamaHostEnv();
  const envBase = envRaw ? asBaseUrl(envRaw) : '';

  // 3. Process inspection (Windows only — finds the actual listening port).
  const proc = await findOllamaProcessPort();
  const procBase = proc ? `http://127.0.0.1:${proc.port}` : '';

  // Build candidate list (de-duped, preserving first-seen order).
  const candidates: Array<{ url: string; source: OllamaScanAttempt['source'] }> = [];
  const seen = new Set<string>();
  const push = (url: string, source: OllamaScanAttempt['source']): void => {
    if (!url) return;
    if (seen.has(url)) return;
    seen.add(url);
    candidates.push({ url, source });
  };
  push(storedBase, 'stored');
  push(envBase, 'env');
  push(procBase, 'process');
  push('http://localhost:11434', 'localhost');
  push('http://127.0.0.1:11434', 'loopback');
  push('http://0.0.0.0:11434', 'all-interfaces');
  // Alt ports — uncommon but a few users run multiple Ollama instances.
  push('http://127.0.0.1:11435', 'alt-port');

  // Probe in parallel. We still want a "first reachable wins" feel for the
  // UI, but parallelism means total time = slowest probe, capped by the
  // 1.5s timeout — much faster than serial.
  const results = await Promise.all(
    candidates.map(async (c) => {
      const probe = await probeOneEndpoint(c.url);
      const attempt: OllamaScanAttempt = {
        url: c.url,
        source: c.source,
        ok: probe.reachable,
        ...(probe.error ? { error: probe.error } : {}),
      };
      return { attempt, probe, url: c.url };
    }),
  );

  for (const r of results) attempts.push(r.attempt);

  // Pick the highest-priority responder (candidates are already in priority order).
  const winner = results.find((r) => r.probe.reachable);

  const result: OllamaScanResult = {
    detected: winner
      ? { url: winner.url, ...winner.probe }
      : null,
    attempted: attempts,
    ...(proc ? { processInfo: proc } : {}),
    ...(envRaw ? { ollamaHostEnv: envRaw } : {}),
  };
  logger.info(
    'brainWizard.scanForOllama:',
    result.detected ? `found at ${result.detected.url}` : 'no responder',
    proc ? `(running pid=${proc.pid} port=${proc.port})` : '',
  );
  return result;
}

async function probeOllama(endpoint?: string): Promise<OllamaProbeResult> {
  const base = normalizeOllamaBase(endpoint);
  return probeOneEndpoint(base);
}

interface ActivePull {
  abort: AbortController;
  pullId: string;
}
const activePulls = new Map<string, ActivePull>();

async function streamOllamaPull(
  model: string,
  endpoint: string | undefined,
  pullId: string,
): Promise<void> {
  const base = normalizeOllamaBase(endpoint);
  const win = getBrainWizardWindow();
  const send = (ev: OllamaPullProgress): void => {
    win?.webContents.send(IPC.brainWizardPullProgress, ev);
  };
  const abort = new AbortController();
  activePulls.set(pullId, { abort, pullId });
  try {
    const res = await fetch(`${base}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
      signal: abort.signal,
    });
    if (!res.ok || !res.body) {
      send({
        pullId,
        status: 'error',
        done: 'error',
        error: `HTTP ${res.status}`,
      });
      return;
    }
    // Ollama streams NDJSON. Read the body as a text stream and emit one
    // progress event per line.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as {
            status?: string;
            digest?: string;
            total?: number;
            completed?: number;
            error?: string;
          };
          if (obj.error) {
            send({ pullId, status: obj.status ?? 'error', done: 'error', error: obj.error });
            return;
          }
          send({
            pullId,
            status: obj.status ?? '',
            ...(obj.digest ? { digest: obj.digest } : {}),
            ...(typeof obj.total === 'number' ? { total: obj.total } : {}),
            ...(typeof obj.completed === 'number' ? { completed: obj.completed } : {}),
          });
          // Ollama's success sentinel.
          if (obj.status === 'success') {
            send({ pullId, status: 'success', done: 'done' });
            return;
          }
        } catch {
          // Ignore malformed lines.
        }
      }
    }
    // Stream closed without an explicit success sentinel — treat as done if
    // we got that far without an error.
    send({ pullId, status: 'success', done: 'done' });
  } catch (err) {
    if (abort.signal.aborted) {
      send({ pullId, status: 'cancelled', done: 'error', error: 'cancelled by user' });
    } else {
      send({
        pullId,
        status: 'error',
        done: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    activePulls.delete(pullId);
  }
}

async function testOllamaModel(
  model: string,
  endpoint: string | undefined,
): Promise<OllamaTestResult> {
  const base = normalizeOllamaBase(endpoint);
  const start = Date.now();
  // Generous timeout — cold-loading an 8B model on CPU-only systems can take
  // 60-90s for the first response. Once it's loaded, subsequent requests
  // return in 5-10s, so the brain controller's 45s tick budget is fine.
  // We also pass keep_alive so the model stays resident between this test and
  // the actual brain's first tick.
  const TEST_TIMEOUT_MS = 120_000;
  try {
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: 'Say one short sentence to confirm you are working. Reply only with the sentence.',
        stream: false,
        keep_alive: '15m',
        options: { temperature: 0.5, num_predict: 60 },
      }),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const data = (await res.json()) as { response?: string };
    const reply = (data.response ?? '').trim();
    return { ok: true, reply, latencyMs };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Hermes probe ──────────────────────────────────────────────────────────

async function probeHermes(endpoint: string, apiKey: string): Promise<HermesProbeResult> {
  if (!endpoint?.trim()) {
    return { reachable: false, models: [], profiles: [], error: 'endpoint blank' };
  }
  let key = apiKey;
  if (key === '__use_saved__') {
    const { getSecret } = await import('../storage/secrets');
    key = (await getSecret('hermes_api_key')) ?? '';
  }
  if (!key) {
    return { reachable: false, models: [], profiles: [], error: 'no API key' };
  }
  const url = endpoint.trim().replace(/\/+$/, '') + '/models';
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      return {
        reachable: false,
        models: [],
        profiles: [],
        error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = (data.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    // Best-effort: also kick off profile discovery against the same host to
    // populate the cached profile list. Non-blocking.
    let profiles: Array<{ name: string; url: string }> = [];
    try {
      profiles = await discoverAllHermesProfiles();
    } catch {
      profiles = [];
    }
    return { reachable: true, models, profiles };
  } catch (err) {
    return {
      reachable: false,
      models: [],
      profiles: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Apply ─────────────────────────────────────────────────────────────────

async function applyBrainConfig(cfg: BrainApplyConfig): Promise<void> {
  const settings = await readStore();
  const nextConfig = { ...(settings.brainControllerConfig ?? {}) };
  if (cfg.config) {
    nextConfig[cfg.controllerId] = { ...(nextConfig[cfg.controllerId] ?? {}), ...cfg.config };
  }
  // For local-llm: also write through to the top-level ollamaEndpoint so the
  // LLM-provider Ollama integration picks it up too. For hermes: same with
  // hermesEndpoint.
  const patch: Partial<typeof settings> = {
    brainController: cfg.controllerId,
    brainControllerConfig: nextConfig,
  };
  if (cfg.controllerId === 'local-llm' && cfg.config?.['endpoint']) {
    patch.ollamaEndpoint = String(cfg.config['endpoint']);
  }
  if (cfg.controllerId === 'hermes' && cfg.config?.['endpoint']) {
    patch.hermesEndpoint = String(cfg.config['endpoint']);
  }
  // Optional mirror-to-chat: configure the conversational LLM to use the same
  // Ollama model. Only meaningful when controllerId is 'local-llm' (Hermes
  // mirroring is also valid but would require more wiring — defer).
  if (cfg.mirrorToChat && cfg.controllerId === 'local-llm' && cfg.config) {
    const model = cfg.config['model'];
    if (typeof model === 'string' && model.trim()) {
      patch.llmProvider = 'ollama';
      patch.llmModel = model.trim();
      // ollamaEndpoint was already set above from the brain config.
      logger.info(`brainWizard.apply: mirroring brain model "${model}" to chat as Ollama provider`);
    }
  }
  await writeStore(patch);
  logger.info('brainWizard.apply: controller ->', cfg.controllerId);
  await swapBrain();
}

// ── Registration ──────────────────────────────────────────────────────────

export function registerBrainWizardHandlers(): void {
  ipcMain.handle(IPC.brainWizardDetectHardware, () => detectHardware());
  ipcMain.handle(IPC.brainWizardScanForOllama, () => scanForOllama());
  ipcMain.handle(IPC.brainWizardProbeOllama, (_e, endpoint?: string) => probeOllama(endpoint));
  ipcMain.handle(IPC.brainWizardListOllamaModels, async (_e, endpoint?: string) => {
    const r = await probeOllama(endpoint);
    return r.installedModels;
  });
  ipcMain.handle(
    IPC.brainWizardPullOllamaModel,
    async (_e, model: string, endpoint?: string) => {
      const pullId = `pull-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Don't await — let it stream while we return the id.
      void streamOllamaPull(model, endpoint, pullId);
      return { pullId };
    },
  );
  ipcMain.handle(IPC.brainWizardCancelPull, (_e, pullId: string) => {
    const p = activePulls.get(pullId);
    if (p) {
      try { p.abort.abort(); } catch { /* noop */ }
      activePulls.delete(pullId);
    }
  });
  ipcMain.handle(
    IPC.brainWizardTestOllamaModel,
    (_e, model: string, endpoint?: string) => testOllamaModel(model, endpoint),
  );
  ipcMain.handle(
    IPC.brainWizardProbeHermes,
    (_e, endpoint: string, apiKey: string) => probeHermes(endpoint, apiKey),
  );
  ipcMain.handle(IPC.brainWizardApply, (_e, cfg: BrainApplyConfig) => applyBrainConfig(cfg));
  ipcMain.handle(IPC.brainWizardOpen, () => {
    openBrainWizardWindow();
  });
  ipcMain.handle(IPC.brainWizardClose, () => {
    closeBrainWizardWindow();
  });
}
