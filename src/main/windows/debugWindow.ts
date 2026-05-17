import { BrowserWindow } from 'electron';
import { join } from 'node:path';

let debugWindow: BrowserWindow | null = null;

export function createDebugWindow(): BrowserWindow {
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.focus();
    return debugWindow;
  }

  debugWindow = new BrowserWindow({
    width: 360,
    height: 640,
    title: 'Merlin — Debug Panel',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/debug.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void debugWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/debug/index.html`);
  } else {
    void debugWindow.loadFile(join(__dirname, '../renderer/debug/index.html'));
  }

  debugWindow.once('ready-to-show', () => debugWindow?.show());

  debugWindow.on('closed', () => {
    debugWindow = null;
  });

  return debugWindow;
}

export function getDebugWindow(): BrowserWindow | null {
  return debugWindow && !debugWindow.isDestroyed() ? debugWindow : null;
}
