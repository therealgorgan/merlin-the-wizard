import { BrowserWindow } from 'electron';
import { join } from 'node:path';

let historyWindow: BrowserWindow | null = null;

export function openHistoryWindow(): BrowserWindow {
  if (historyWindow && !historyWindow.isDestroyed()) {
    historyWindow.show();
    historyWindow.focus();
    return historyWindow;
  }
  historyWindow = new BrowserWindow({
    width: 640,
    height: 720,
    title: 'Merlin — Conversation History',
    autoHideMenuBar: true,
    backgroundColor: '#1a1a1f',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/history.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void historyWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/history/index.html`);
  } else {
    void historyWindow.loadFile(join(__dirname, '../renderer/history/index.html'));
  }
  historyWindow.once('ready-to-show', () => historyWindow?.show());
  historyWindow.on('closed', () => {
    historyWindow = null;
  });
  return historyWindow;
}
