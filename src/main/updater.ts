import { app, dialog, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { logger } from './logger';

/**
 * Wires electron-updater to GitHub Releases.
 * Checks once at startup (after a short delay so launch isn't blocked),
 * then every 4 hours while the app is running. Prompts the user when an
 * update has finished downloading.
 */
export function startAutoUpdater(): void {
  if (!app.isPackaged) {
    logger.info('updater: skipped (not packaged — running from source)');
    return;
  }

  autoUpdater.logger = log;
  log.transports.file.level = 'info';
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => logger.info('updater: checking for updates'));
  autoUpdater.on('update-available', (info) =>
    logger.info(`updater: update available v${info.version}`),
  );
  autoUpdater.on('update-not-available', () => logger.info('updater: app is up-to-date'));
  autoUpdater.on('error', (err) => logger.warn(`updater: error ${err.message}`));
  autoUpdater.on('download-progress', (p) =>
    logger.info(`updater: ${p.percent.toFixed(0)}% (${Math.round(p.bytesPerSecond / 1024)} KB/s)`),
  );

  autoUpdater.on('update-downloaded', async (info) => {
    logger.info(`updater: downloaded v${info.version}, prompting user`);
    const choice = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Install now', 'Install on next launch', 'View release notes'],
      defaultId: 0,
      cancelId: 1,
      title: 'Merlin update ready',
      message: `Merlin v${info.version} is downloaded and ready to install.`,
      detail: 'The app will close briefly while the installer runs.',
    });

    if (choice.response === 0) {
      autoUpdater.quitAndInstall();
    } else if (choice.response === 2) {
      void shell.openExternal(
        `https://github.com/therealgorgan/merlin-the-wizard/releases/tag/v${info.version}`,
      );
    }
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((e) =>
      logger.warn(`updater: initial check failed ${(e as Error).message}`),
    );
  }, 10_000);

  setInterval(
    () => {
      void autoUpdater.checkForUpdates().catch((e) =>
        logger.warn(`updater: periodic check failed ${(e as Error).message}`),
      );
    },
    4 * 60 * 60 * 1000,
  );
}

export type ManualCheckResult =
  | { status: 'update-available'; version: string }
  | { status: 'up-to-date' }
  | { status: 'disabled' };

/**
 * Manual "Check for Updates" entry point for the tray menu. Routes through
 * the same statically-imported `autoUpdater` the background loop uses, which
 * compiles to a direct `require('electron-updater').autoUpdater` property read.
 *
 * Do NOT `await import('electron-updater')` from the caller: in the bundled
 * output that becomes a native dynamic `import()` of a CJS module, whose
 * namespace exposes `autoUpdater` only as a lazy getter the module lexer
 * can't see — so `const { autoUpdater } = await import(...)` is `undefined`,
 * and `autoUpdater.checkForUpdates()` threw
 * "Cannot read properties of undefined (reading 'checkForUpdates')".
 */
export async function checkForUpdatesNow(): Promise<ManualCheckResult> {
  if (!app.isPackaged) return { status: 'disabled' };
  const r = await autoUpdater.checkForUpdates();
  const version = r?.updateInfo?.version;
  if (version && version !== app.getVersion()) {
    return { status: 'update-available', version };
  }
  return { status: 'up-to-date' };
}
