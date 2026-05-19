import { app } from 'electron';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../logger';

export interface StoreData {
  zoom: number;
  muteSounds: boolean;
  /** 'off' | 'sapi' (Windows local) | 'groq' (Orpheus cloud) */
  voiceEngine: string;
  /** Voice name. For sapi: any installed Windows voice (David, Zira, ...). */
  /** For groq: one of troy/austin/daniel/autumn/diana/hannah. */
  voiceName: string;
  userName: string | null;
  mood: string;
  /** LLM provider: 'groq' | 'openrouter' | 'ollama' | 'minimax' */
  llmProvider: string;
  /** Model name within the chosen provider. */
  llmModel: string;
  /** Endpoint for the local Ollama server. */
  ollamaEndpoint: string;
  /** Base URL for a Hermes Agent api_server, e.g. http://your-hermes-host:8642/v1 */
  hermesEndpoint: string;
  /** Cached list of all reachable Hermes profiles on the configured host. */
  /** Populated by the "Discover all" button; consumed by the tray submenu. */
  hermesProfiles: Array<{ name: string; url: string }>;
  /** Avatar character to use (clippyjs agent name). */
  character: string;
  /** Global hotkey to summon Merlin (Electron Accelerator string). */
  summonHotkey: string;
  /** Start Merlin automatically when Windows starts. */
  autoStart: boolean;
  /** Brain occasionally surfaces an unprompted thought when user is idle. */
  idleThoughtsEnabled: boolean;
  /** Show the welcome greeting on app startup. */
  showWelcomeOnStart: boolean;
  /** Voice the welcome (if a TTS engine is enabled). */
  speakWelcome: boolean;
  /** Global hotkey to capture the screen + attach it to next message. */
  screenshotHotkey: string;
  /** Enable/disable the screenshot hotkey. */
  screenshotHotkeyEnabled: boolean;
  /** 'classic' (floating bubble) | 'modern' (panel with embedded sprite + thread) */
  displayMode: 'classic' | 'modern';
  /** 'classic' (pixelated retro sprites) | 'retouched' (CSS-smoothed for modern feel) */
  appearance: 'classic' | 'retouched';
  /** Per-behavior feature flags (0.4.0+). Keyed by extension flag id (e.g. */
  /** `behavior.drag.sway`). Missing key = use default from extensions catalog. */
  /** Values are boolean | string (booleans for on/off toggles, strings for */
  /** select-type flags like which drag animation to play). */
  extensions: Record<string, boolean | string>;
  /** Active brain controller id (0.4.0 ships only 'default'; 0.5.0 adds 'local-llm' / 'hermes'). */
  brainController: string;
  /** Per-controller configuration map. Outer key = controller id, inner = arbitrary settings. */
  brainControllerConfig: Record<string, Record<string, unknown>>;
}

const DEFAULTS: StoreData = {
  zoom: 1.0,
  muteSounds: false,
  voiceEngine: 'off',
  voiceName: 'troy',
  userName: null,
  mood: 'cheerful',
  llmProvider: 'groq',
  llmModel: 'llama-3.3-70b-versatile',
  ollamaEndpoint: 'http://localhost:11434/api',
  hermesEndpoint: '',
  hermesProfiles: [],
  character: 'Merlin',
  summonHotkey: 'Control+Shift+M',
  autoStart: false,
  idleThoughtsEnabled: true,
  showWelcomeOnStart: true,
  speakWelcome: true,
  screenshotHotkey: 'Control+Shift+S',
  screenshotHotkeyEnabled: true,
  displayMode: 'classic',
  appearance: 'classic',
  extensions: {},
  brainController: 'default',
  brainControllerConfig: {},
};

let cache: StoreData | null = null;
let path: string | null = null;
let writePromise: Promise<void> = Promise.resolve();

function file(): string {
  if (!path) path = join(app.getPath('userData'), 'store.json');
  return path;
}

export async function read(): Promise<StoreData> {
  if (cache) return cache;
  try {
    const txt = await fsp.readFile(file(), 'utf8');
    const data = JSON.parse(txt) as Partial<StoreData>;
    cache = { ...DEFAULTS, ...data };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export async function write(patch: Partial<StoreData>): Promise<StoreData> {
  const current = await read();
  cache = { ...current, ...patch };
  const snapshot = cache;
  // Serialize writes so we never race.
  writePromise = writePromise.then(() =>
    fsp.writeFile(file(), JSON.stringify(snapshot, null, 2), 'utf8').catch((err) => {
      logger.error('store write failed', err);
    }),
  );
  await writePromise;
  return cache;
}
