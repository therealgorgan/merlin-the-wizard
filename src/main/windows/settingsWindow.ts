import { BrowserWindow } from 'electron';
import { join } from 'node:path';

let settingsWindow: BrowserWindow | null = null;

export interface OpenSettingsOptions {
  /** Optional URL hash to scroll to a specific section, e.g. 'extensions'. */
  hash?: string;
}

export function openSettingsWindow(opts: OpenSettingsOptions = {}): BrowserWindow {
  const hash = opts.hash ?? '';

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    if (hash) {
      // Already open — scroll to the section via JS.
      void settingsWindow.webContents.executeJavaScript(
        `document.getElementById(${JSON.stringify(hash.replace(/^#/, ''))})?.scrollIntoView({ behavior: 'smooth' })`,
      ).catch(() => { /* ignore */ });
    }
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: 560,
    height: 720,
    title: 'Merlin — Settings',
    autoHideMenuBar: true,
    backgroundColor: '#1a1a1f',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/settings.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });

  const hashSuffix = hash ? `#${hash.replace(/^#/, '')}` : '';
  if (process.env.ELECTRON_RENDERER_URL) {
    void settingsWindow.loadURL(
      `${process.env.ELECTRON_RENDERER_URL}/settings/index.html${hashSuffix}`,
    );
  } else {
    void settingsWindow.loadFile(join(__dirname, '../renderer/settings/index.html'), {
      hash: hash.replace(/^#/, ''),
    });
  }

  settingsWindow.once('ready-to-show', () => settingsWindow?.show());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  return settingsWindow;
}

export function closeSettingsWindow(): void {
  settingsWindow?.close();
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null;
}
