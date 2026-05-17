import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { IPC } from '@shared/ipc-contract';
import type { AnimationName } from '@shared/animations';
import { logger } from '../logger';

const PANEL_W = 480;
const PANEL_H = 720;

let panelWindow: BrowserWindow | null = null;

export function createChatPanelWindow(): BrowserWindow {
  if (panelWindow && !panelWindow.isDestroyed()) return panelWindow;

  // Anchor to the bottom-right corner of the primary display by default.
  const primary = screen.getPrimaryDisplay();
  const { workArea } = primary;
  const x = workArea.x + workArea.width - PANEL_W - 24;
  const y = workArea.y + workArea.height - PANEL_H - 24;

  panelWindow = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    x,
    y,
    frame: false,
    transparent: false,
    backgroundColor: '#1a1a1f',
    alwaysOnTop: true,
    hasShadow: true,
    skipTaskbar: true,
    resizable: true,
    minWidth: 380,
    minHeight: 480,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/chatPanel.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });

  panelWindow.setAlwaysOnTop(true, 'floating');

  panelWindow.webContents.session.setPermissionRequestHandler(
    (_wc, permission, callback) => {
      if (permission === 'media') {
        callback(true);
        return;
      }
      callback(false);
    },
  );

  if (process.env.ELECTRON_RENDERER_URL) {
    void panelWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/chat-panel/index.html`);
  } else {
    void panelWindow.loadFile(join(__dirname, '../renderer/chat-panel/index.html'));
  }

  panelWindow.on('closed', () => {
    panelWindow = null;
  });

  // Pipe renderer console to main log for debugging the embedded sprite/audio.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (panelWindow.webContents as any).on(
    'console-message',
    (_e: unknown, _level: number, message: string) => {
      if (typeof message === 'string' && message.includes('[merlin-')) {
        logger.info('[panel-console]', message);
      }
    },
  );

  return panelWindow;
}

export function getChatPanelWindow(): BrowserWindow | null {
  return panelWindow && !panelWindow.isDestroyed() ? panelWindow : null;
}

export function showChatPanel(): void {
  const w = createChatPanelWindow();
  if (w.webContents.isLoading()) {
    w.webContents.once('did-finish-load', () => {
      w.show();
    });
  } else {
    w.show();
  }
}

export function hideChatPanel(): void {
  panelWindow?.hide();
}

export function focusPanelInput(): void {
  const w = getChatPanelWindow();
  if (!w) return;
  w.show();
  w.focus();
  w.webContents.send(IPC.panelOpenForAsk);
}

/** Send an animation to the panel's embedded clippyjs sprite. */
export function panelPlayAnimation(name: AnimationName): void {
  panelWindow?.webContents.send(IPC.spritePlay, name);
}

/** Send audio data URL to the panel's embedded audio player. */
export function panelPlayAudio(dataUrl: string): void {
  panelWindow?.webContents.send(IPC.spritePlayAudio, dataUrl);
}

export function panelStopAudio(): void {
  panelWindow?.webContents.send(IPC.spriteStopAudio);
}

export function panelSetCharacter(characterId: string): void {
  panelWindow?.webContents.send(IPC.spriteSetCharacter, characterId);
}

/** Streaming chat IPC into the panel. */
export function panelSetStreaming(streaming: boolean): void {
  panelWindow?.webContents.send(IPC.panelSetStreaming, streaming);
}

export function panelAppendAssistantChunk(text: string): void {
  panelWindow?.webContents.send(IPC.panelAppendAssistantChunk, text);
}

export function panelFinalizeAssistant(text: string): void {
  panelWindow?.webContents.send(IPC.panelFinalizeAssistant, text);
}

export function panelAddUserTurn(text: string): void {
  panelWindow?.webContents.send(IPC.panelAddUserTurn, text);
}

export function panelSetSuggestions(items: string[]): void {
  panelWindow?.webContents.send(IPC.panelSetSuggestions, items);
}
