import { BrowserWindow } from 'electron';
import { join } from 'node:path';

let setupWizardWindow: BrowserWindow | null = null;

export function openSetupWizardWindow(): BrowserWindow {
  if (setupWizardWindow && !setupWizardWindow.isDestroyed()) {
    setupWizardWindow.show();
    setupWizardWindow.focus();
    return setupWizardWindow;
  }

  setupWizardWindow = new BrowserWindow({
    width: 680,
    height: 740,
    title: 'Welcome to Merlin — First-Time Setup',
    autoHideMenuBar: true,
    backgroundColor: '#1a1a1f',
    show: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/setupWizard.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void setupWizardWindow.loadURL(
      `${process.env.ELECTRON_RENDERER_URL}/setup-wizard/index.html`,
    );
  } else {
    void setupWizardWindow.loadFile(
      join(__dirname, '../renderer/setup-wizard/index.html'),
    );
  }

  setupWizardWindow.once('ready-to-show', () => setupWizardWindow?.show());
  setupWizardWindow.on('closed', () => {
    setupWizardWindow = null;
    // Mark firstRunComplete so the wizard doesn't auto-pop again next launch
    // even if the user just X'd the window without hitting Finish. Bailing
    // out is fine — the wizard is always re-openable from tray / Settings.
    void (async (): Promise<void> => {
      try {
        const { write } = await import('../storage/store');
        await write({ firstRunComplete: true });
      } catch {
        /* best-effort; not fatal if the write fails */
      }
    })();
  });

  return setupWizardWindow;
}

export function closeSetupWizardWindow(): void {
  setupWizardWindow?.close();
}

export function getSetupWizardWindow(): BrowserWindow | null {
  return setupWizardWindow && !setupWizardWindow.isDestroyed()
    ? setupWizardWindow
    : null;
}
