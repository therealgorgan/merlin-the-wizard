import { BrowserWindow } from 'electron';
import { join } from 'node:path';

let brainWizardWindow: BrowserWindow | null = null;

export function openBrainWizardWindow(): BrowserWindow {
  if (brainWizardWindow && !brainWizardWindow.isDestroyed()) {
    brainWizardWindow.show();
    brainWizardWindow.focus();
    return brainWizardWindow;
  }

  brainWizardWindow = new BrowserWindow({
    width: 640,
    height: 720,
    title: 'Merlin — Brain Setup Wizard',
    autoHideMenuBar: true,
    backgroundColor: '#1a1a1f',
    show: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/brainWizard.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void brainWizardWindow.loadURL(
      `${process.env.ELECTRON_RENDERER_URL}/brain-wizard/index.html`,
    );
  } else {
    void brainWizardWindow.loadFile(
      join(__dirname, '../renderer/brain-wizard/index.html'),
    );
  }

  brainWizardWindow.once('ready-to-show', () => brainWizardWindow?.show());
  brainWizardWindow.on('closed', () => {
    brainWizardWindow = null;
  });

  return brainWizardWindow;
}

export function closeBrainWizardWindow(): void {
  brainWizardWindow?.close();
}

export function getBrainWizardWindow(): BrowserWindow | null {
  return brainWizardWindow && !brainWizardWindow.isDestroyed()
    ? brainWizardWindow
    : null;
}
