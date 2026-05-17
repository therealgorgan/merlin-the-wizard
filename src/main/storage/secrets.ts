import { app, safeStorage } from 'electron';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../logger';

// API keys live in userData/secrets.json. Encrypted via Electron's safeStorage
// (DPAPI on Windows). Each value is `enc:<base64>` for encrypted, or
// `plain:<raw>` only as a fallback when DPAPI is unavailable.

interface SecretsFile {
  [name: string]: string;
}

let cache: SecretsFile | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function filePath(): string {
  return join(app.getPath('userData'), 'secrets.json');
}

async function load(): Promise<SecretsFile> {
  if (cache) return cache;
  try {
    const txt = await fsp.readFile(filePath(), 'utf-8');
    cache = JSON.parse(txt) as SecretsFile;
  } catch {
    cache = {};
  }
  return cache;
}

function persist(): void {
  const snapshot = { ...(cache ?? {}) };
  writeQueue = writeQueue.then(async () => {
    try {
      await fsp.writeFile(filePath(), JSON.stringify(snapshot, null, 2), 'utf-8');
    } catch (err) {
      logger.error('secrets write failed', err);
    }
  });
}

export async function setSecret(name: string, value: string): Promise<void> {
  const data = await load();
  if (!value) {
    delete data[name];
    persist();
    return;
  }
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(value);
    data[name] = `enc:${encrypted.toString('base64')}`;
  } else {
    logger.warn('safeStorage unavailable — storing', name, 'in plaintext');
    data[name] = `plain:${value}`;
  }
  persist();
}

export async function getSecret(name: string): Promise<string | null> {
  const data = await load();
  const stored = data[name];
  if (!stored) return null;
  if (stored.startsWith('plain:')) return stored.slice('plain:'.length);
  if (stored.startsWith('enc:')) {
    try {
      const buf = Buffer.from(stored.slice('enc:'.length), 'base64');
      return safeStorage.decryptString(buf);
    } catch (err) {
      logger.error('decrypt failed for', name, err);
      return null;
    }
  }
  // Legacy / unknown prefix — treat as raw.
  return stored;
}

export async function hasSecret(name: string): Promise<boolean> {
  return (await getSecret(name)) !== null;
}

export async function clearSecret(name: string): Promise<void> {
  await setSecret(name, '');
}
