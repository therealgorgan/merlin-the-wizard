import { app, dialog, shell, net } from 'electron';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from './logger';

/**
 * Self-rolled GitHub-Releases updater. Modelled on the Close-Apps-On-Idle
 * approach, which is robust precisely because it does NOT silently self-install:
 *
 *   1. Check the GitHub Releases API for a newer tag than app.getVersion().
 *   2. Download the published Merlin-Setup.exe to a temp dir.
 *   3. Launch the installer as a detached process and quit — the user sees the
 *      full NSIS installer UI and can click through Windows SmartScreen's
 *      "More info -> Run anyway" prompt.
 *
 * This deliberately replaces electron-updater. Its `quitAndInstall` runs the
 * installer silently (/S); for an unsigned build Windows SmartScreen/Defender
 * blocks the unknown-publisher exe with no UI, so updates silently failed.
 * Keeping the user in the loop for the OS security prompt is what makes this
 * actually land.
 */

const REPO = 'therealgorgan/merlin-the-wizard';
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
// Stable redirect to the newest release's asset — survives version bumps.
const INSTALLER_URL = `https://github.com/${REPO}/releases/latest/download/Merlin-Setup.exe`;

const STARTUP_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

interface UpdateInfo {
  version: string;
  notes: string;
}

/** Parse '1.2.3' / 'v1.2.3' into [1,2,3] for numeric comparison. */
function parseVersion(v: string): number[] {
  return v
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
}

function isNewer(remote: string, current: string): boolean {
  const a = parseVersion(remote);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** GET JSON via Electron net (follows redirects, uses the OS proxy/cert store). */
function httpGetJson(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow' });
    req.setHeader('User-Agent', 'merlin-the-wizard-updater');
    req.setHeader('Accept', 'application/vnd.github+json');
    req.on('response', (res) => {
      const status = res.statusCode ?? 0;
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.from(c)));
      res.on('end', () => {
        if (status >= 400) {
          reject(new Error(`GitHub API returned HTTP ${status}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
        } catch (e) {
          reject(e as Error);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

/** Returns update info if the latest published release is newer, else null. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const data = await httpGetJson(LATEST_API);
  const tag = String(data.tag_name ?? '');
  const remote = tag.replace(/^v/i, '');
  if (remote && isNewer(remote, app.getVersion())) {
    return { version: remote, notes: String(data.body ?? '').slice(0, 1500) };
  }
  return null;
}

/** Stream the installer to a temp file. Resolves with its path. */
function downloadInstaller(onProgress?: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    mkdtemp(join(tmpdir(), 'merlin-update-'))
      .then((dir) => {
        const dest = join(dir, 'Merlin-Setup.exe');
        const req = net.request({ url: INSTALLER_URL, redirect: 'follow' });
        req.setHeader('User-Agent', 'merlin-the-wizard-updater');
        req.on('response', (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 400) {
            reject(new Error(`Download returned HTTP ${status}`));
            return;
          }
          const total = parseInt(String(res.headers['content-length'] ?? '0'), 10);
          let got = 0;
          let lastPct = -1;
          const out = createWriteStream(dest);
          out.on('error', reject);
          res.on('data', (c) => {
            const buf = Buffer.from(c);
            out.write(buf);
            got += buf.length;
            if (onProgress && total > 0) {
              const pct = Math.round((got / total) * 100);
              if (pct !== lastPct) {
                lastPct = pct;
                onProgress(pct);
              }
            }
          });
          res.on('end', () => out.end(() => resolve(dest)));
          res.on('error', reject);
        });
        req.on('error', reject);
        req.end();
      })
      .catch(reject);
  });
}

/** Launch the installer detached and quit so it can replace the running app. */
function runInstallerAndQuit(installerPath: string): void {
  logger.info(`updater: launching installer ${installerPath}`);
  try {
    const child = spawn(installerPath, [], { detached: true, stdio: 'ignore' });
    child.unref();
    // Give the OS a beat to start the process before we exit.
    setTimeout(() => app.quit(), 800);
  } catch (e) {
    logger.error(`updater: failed to launch installer ${(e as Error).message}`);
  }
}

let updateInFlight = false;

/**
 * Full update flow. `interactive` = the user clicked "Check for Updates…", so
 * surface up-to-date / network-error outcomes too. Background calls stay quiet
 * unless an update is actually available.
 */
export async function checkAndMaybeUpdate(interactive: boolean): Promise<void> {
  if (!app.isPackaged) {
    if (interactive) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Updates run in the installed app',
        message: 'Auto-update is only active in the packaged build, not when running from source.',
      });
    }
    return;
  }
  if (updateInFlight) return;
  updateInFlight = true;
  try {
    let info: UpdateInfo | null;
    try {
      info = await checkForUpdate();
    } catch (e) {
      logger.warn(`updater: check failed ${(e as Error).message}`);
      if (interactive) {
        await dialog.showMessageBox({
          type: 'warning',
          title: 'Update check failed',
          message: 'Could not reach GitHub Releases.',
          detail: (e as Error).message,
        });
      }
      return;
    }

    if (!info) {
      logger.info(`updater: up-to-date (v${app.getVersion()})`);
      if (interactive) {
        await dialog.showMessageBox({
          type: 'info',
          title: 'Merlin is up-to-date',
          message: `You're running v${app.getVersion()} — the latest published release.`,
        });
      }
      return;
    }

    logger.info(`updater: update available v${info.version}`);
    const offer = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Download & Install', 'Release notes', 'Later'],
      defaultId: 0,
      cancelId: 2,
      title: 'Update available',
      message: `Merlin v${info.version} is available (you have v${app.getVersion()}).`,
      detail:
        (info.notes ? `${info.notes}\n\n` : '') +
        'Merlin will download the installer, then open it so you can confirm.',
    });

    if (offer.response === 1) {
      void shell.openExternal(`https://github.com/${REPO}/releases/tag/v${info.version}`);
      return;
    }
    if (offer.response !== 0) return; // Later / dismissed

    let installerPath: string;
    try {
      installerPath = await downloadInstaller((pct) => {
        if (pct % 25 === 0) logger.info(`updater: download ${pct}%`);
      });
    } catch (e) {
      logger.warn(`updater: download failed ${(e as Error).message}`);
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Download failed',
        message: 'Could not download the update.',
        detail: (e as Error).message,
      });
      return;
    }

    const go = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Install now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Merlin v${info.version} is ready to install.`,
      detail:
        'The installer will open and Merlin will close. If Windows shows a ' +
        'security prompt, choose "More info → Run anyway".',
    });

    if (go.response === 0) runInstallerAndQuit(installerPath);
  } finally {
    updateInFlight = false;
  }
}

/**
 * Wires the background updater: one check shortly after launch (so startup
 * isn't blocked), then every 4 hours. No-op in dev.
 */
export function startAutoUpdater(): void {
  if (!app.isPackaged) {
    logger.info('updater: skipped (not packaged — running from source)');
    return;
  }
  setTimeout(() => void checkAndMaybeUpdate(false), STARTUP_DELAY_MS);
  setInterval(() => void checkAndMaybeUpdate(false), CHECK_INTERVAL_MS);
}
