import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { logger } from '../logger';

export interface SapiVoiceInfo {
  name: string;
  /** Best-effort gender ('Male' | 'Female' | '') parsed from SAPI metadata. */
  gender: string;
  /** Best-effort age category ('Adult' | 'Child' | 'Senior' | ''). */
  age: string;
  /** Culture / locale name (e.g. 'en-US'). */
  culture: string;
}

let voicesCache: SapiVoiceInfo[] | null = null;

// Windows-native TTS via System.Speech (PowerShell). Free, offline, uses the
// voices that ship with Windows 11 (David, Zira, Hazel, Mark). Decent quality
// in a slightly robotic register — fits the nostalgia.

const POWERSHELL = 'powershell.exe';

/** Enumerate installed System.Speech voices on Windows. Result is cached for */
/** the process lifetime; voices don't change at runtime. */
export async function getSapiVoices(): Promise<SapiVoiceInfo[]> {
  if (process.platform !== 'win32') return [];
  if (voicesCache) return voicesCache;

  const script =
    `$ErrorActionPreference='Stop'; ` +
    `Add-Type -AssemblyName System.Speech; ` +
    `$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
    `$synth.GetInstalledVoices() | ForEach-Object { ` +
    `  $info = $_.VoiceInfo; ` +
    `  '{0}|{1}|{2}|{3}' -f $info.Name, $info.Gender, $info.Age, $info.Culture.Name ` +
    `}; ` +
    `$synth.Dispose();`;

  return new Promise<SapiVoiceInfo[]>((resolve) => {
    const proc = spawn(POWERSHELL, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => {
      logger.warn('getSapiVoices spawn error', err.message);
      resolve([]);
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        logger.warn('getSapiVoices exited', code, stderr.slice(0, 200));
        resolve([]);
        return;
      }
      const out: SapiVoiceInfo[] = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [name, gender, age, culture] = line.split('|');
          return {
            name: name ?? '',
            gender: gender ?? '',
            age: age ?? '',
            culture: culture ?? '',
          };
        })
        .filter((v) => v.name);
      voicesCache = out;
      logger.info(`SAPI voices: ${out.length} found`);
      resolve(out);
    });
  });
}

/**
 * Synthesize speech with Windows SAPI. Writes a wav to a temp file, returns
 * the bytes. ~150-300ms startup latency per call (PowerShell cold start).
 */
export async function synthesizeSapi(
  text: string,
  voiceName?: string | null,
): Promise<Buffer | null> {
  if (process.platform !== 'win32') {
    logger.warn('SAPI is Windows-only');
    return null;
  }
  const tmp = join(
    os.tmpdir(),
    `merlin-sapi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
  );
  // PowerShell reads the text from stdin (handles apostrophes, quotes, unicode
  // without escaping). Writes wav to a temp file then exits.
  const wavPath = tmp.replace(/'/g, "''");
  const voicePick = voiceName
    ? `try { $synth.SelectVoice('${voiceName.replace(/'/g, "''")}') } catch {}`
    : '';
  const script =
    `$ErrorActionPreference='Stop'; ` +
    `Add-Type -AssemblyName System.Speech; ` +
    `$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
    voicePick +
    ` $synth.Rate = 0; ` +
    `$synth.SetOutputToWaveFile('${wavPath}'); ` +
    `$text = [Console]::In.ReadToEnd(); ` +
    `$synth.Speak($text); ` +
    `$synth.Dispose();`;

  return await new Promise<Buffer | null>((resolve) => {
    const proc = spawn(POWERSHELL, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => {
      logger.warn('SAPI spawn error', err.message);
      resolve(null);
    });
    proc.on('close', async (code) => {
      if (code !== 0) {
        logger.warn('SAPI exited', code, stderr.slice(0, 200));
        resolve(null);
        return;
      }
      try {
        const buf = await fsp.readFile(tmp);
        await fsp.unlink(tmp).catch(() => {});
        resolve(buf);
      } catch (err) {
        logger.warn('SAPI read failed', err);
        resolve(null);
      }
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}
