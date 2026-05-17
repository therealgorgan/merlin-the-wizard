import { app } from 'electron';
import { read as readStore, write as writeStore } from './storage/store';
import { logger } from './logger';

// Windows login-item autostart. Uses Electron's setLoginItemSettings, which
// writes to HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run.
// In dev (running via electron-vite/npm), `app.getPath('exe')` is the dev
// electron binary — not what users want at boot. We only enable autostart
// in packaged builds. Setting the flag in dev silently no-ops.

export async function setAutoStart(enabled: boolean): Promise<boolean> {
  await writeStore({ autoStart: enabled });
  if (!app.isPackaged) {
    logger.info('autoStart toggled to', enabled, '(dev mode — not applied to OS)');
    return enabled;
  }
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      // Open hidden (Merlin lives in the tray; no main window needs to pop up).
      openAsHidden: false,
      args: ['--autostart'],
    });
    logger.info('autoStart applied:', enabled);
  } catch (err) {
    logger.warn('setLoginItemSettings failed', err);
  }
  return enabled;
}

export async function getAutoStart(): Promise<boolean> {
  return (await readStore()).autoStart;
}

/** Apply the persisted autostart flag to the OS on boot. */
/** Idempotent — safe to call every launch. */
export async function syncAutoStartOnBoot(): Promise<void> {
  if (!app.isPackaged) return;
  const settings = await readStore();
  const desired = Boolean(settings.autoStart);
  const current = app.getLoginItemSettings().openAtLogin;
  if (desired === current) return;
  app.setLoginItemSettings({
    openAtLogin: desired,
    openAsHidden: false,
    args: ['--autostart'],
  });
}
