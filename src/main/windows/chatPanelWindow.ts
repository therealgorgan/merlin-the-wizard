import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { IPC, type PanelIdleThought, type TailPlacement, type TailSide } from '@shared/ipc-contract';
import type { AnimationName } from '@shared/animations';
import { getSpriteWindow } from './spriteWindow';
import { logger } from '../logger';

const PANEL_W = 480;
const PANEL_H = 640;
const PANEL_MIN_W = 380;
const PANEL_MIN_H = 460;
const GAP = 22;

let panelWindow: BrowserWindow | null = null;
let onUserMoveCallback: (() => void) | null = null;
let suppressNextMoves = 0;

function programmatic<T>(fn: () => T): T {
  // Counter decremented in the panel's 'move' event handler — same pattern as
  // bubbleWindow. Internal programmatic moves (sprite-follow, mode-toggle
  // reposition) must NOT fire the user-move callback that drags the sprite
  // along, or we'd ping-pong.
  suppressNextMoves++;
  return fn();
}

function safeInt(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(n);
}

export function setOnPanelUserMove(cb: (() => void) | null): void {
  onUserMoveCallback = cb;
}

export function createChatPanelWindow(): BrowserWindow {
  if (panelWindow && !panelWindow.isDestroyed()) return panelWindow;

  // Anchor to the bottom-right corner of the primary display by default.
  // positionPanelRelativeToSprite() will move us alongside Merlin as soon as
  // the panel is shown.
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
    // Transparent so the .panel-tail can stick out past the dark inner panel
    // body (just like the speech bubble). The dark theme + border + drop
    // shadow are painted inside the renderer on the .panel element.
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minWidth: PANEL_MIN_W,
    minHeight: PANEL_MIN_H,
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

  panelWindow.on('move', () => {
    if (suppressNextMoves > 0) {
      suppressNextMoves--;
      return;
    }
    if (onUserMoveCallback) onUserMoveCallback();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void panelWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/chat-panel/index.html`);
  } else {
    void panelWindow.loadFile(join(__dirname, '../renderer/chat-panel/index.html'));
  }

  panelWindow.on('closed', () => {
    panelWindow = null;
  });

  // Pipe renderer console to main log for debugging.
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
  const reveal = (): void => {
    w.show();
    // Position next to Merlin now that the sprite is visible.
    positionPanelRelativeToSprite();
    syncPanelTailSide();
  };
  if (w.webContents.isLoading()) {
    w.webContents.once('did-finish-load', reveal);
  } else {
    reveal();
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

/** Push an idle thought into the panel. The renderer shows it with a */
/** countdown and auto-removes when ttlMs elapses (or earlier if dismissed). */
export function panelAddIdleThought(thought: PanelIdleThought): void {
  panelWindow?.webContents.send(IPC.panelAddIdleThought, thought);
}

/** Position the panel alongside Merlin — to his left by default, flipped to */
/** the right if it would land off-screen. Clamped vertically to the work */
/** area. Called on first show and on display-mode toggle to modern. */
export function positionPanelRelativeToSprite(): void {
  const w = panelWindow;
  if (!w || w.isDestroyed()) return;
  const sprite = getSpriteWindow();
  if (!sprite) return;
  const [sx, sy] = sprite.getPosition();
  const [sw, sh] = sprite.getSize();
  const [pw, ph] = w.getSize();
  const sx0 = sx ?? 0;
  const sy0 = sy ?? 0;
  const sw0 = sw ?? 220;
  const sh0 = sh ?? 220;
  const pw0 = pw ?? PANEL_W;
  const ph0 = ph ?? PANEL_H;

  // Default: panel to the left of sprite, top-aligned with sprite center
  // shifted up so the panel's middle is roughly at sprite center.
  let x = sx0 - pw0 - GAP;
  let y = sy0 + sh0 / 2 - ph0 / 2;

  const display = screen.getDisplayMatching({
    x: sx0, y: sy0, width: sw0, height: sh0,
  });
  const wa = display.workArea;

  // Horizontal flip: if no room on the left, try the right side of sprite.
  if (x < wa.x + 8) {
    x = sx0 + sw0 + GAP;
  }
  // Clamp horizontal as a fallback (e.g. very narrow screen).
  x = Math.max(wa.x + 8, Math.min(wa.x + wa.width - pw0 - 8, x));
  // Clamp vertical.
  y = Math.max(wa.y + 8, Math.min(wa.y + wa.height - ph0 - 8, y));

  programmatic(() => w.setPosition(Math.round(x), Math.round(y)));
}

/** Move the panel by (dx, dy) without firing the user-move callback. */
export function programmaticMovePanelBy(dx: number, dy: number): void {
  const w = panelWindow;
  if (!w || w.isDestroyed()) return;
  const [x, y] = w.getPosition();
  const cx = x ?? 0;
  const cy = y ?? 0;
  const nx = safeInt(cx + dx);
  const ny = safeInt(cy + dy);
  if (nx === null || ny === null) {
    logger.warn('programmaticMovePanelBy: bad coords, dropping', { x, y, dx, dy });
    return;
  }
  // Noop skip — see programmaticSetSpritePosition for the counter-leak issue.
  // Critical for the panel because slow smooth moves round to no-op many ticks
  // in a row, leaking the suppressNextMoves counter and eventually swallowing
  // real user-drag move events so the panel stops following the sprite.
  if (nx === cx && ny === cy) return;
  programmatic(() => w.setPosition(nx, ny));
}

/** Set the panel's absolute position without firing the user-move callback. */
export function programmaticSetPanelPosition(x: number, y: number): void {
  const w = panelWindow;
  if (!w || w.isDestroyed()) return;
  const nx = safeInt(x);
  const ny = safeInt(y);
  if (nx === null || ny === null) {
    logger.warn('programmaticSetPanelPosition: bad coords, dropping', { x, y });
    return;
  }
  const [cx, cy] = w.getPosition();
  if ((cx ?? 0) === nx && (cy ?? 0) === ny) return;
  programmatic(() => w.setPosition(nx, ny));
}

/** Compute tail placement: pick the panel edge closest to the sprite (left/ */
/** right/top/bottom) and the offset along that edge so the tail actually */
/** points at Merlin's center. Same logic as the bubble. */
function computePanelTailPlacement(): TailPlacement {
  const w = panelWindow;
  const sprite = getSpriteWindow();
  if (!w || !sprite) return { side: 'right', offset: 0.5 };
  const [px, py] = w.getPosition();
  const [pw, ph] = w.getSize();
  const [sx, sy] = sprite.getPosition();
  const [sw, sh] = sprite.getSize();
  const px0 = px ?? 0;
  const py0 = py ?? 0;
  const pw0 = pw ?? PANEL_W;
  const ph0 = ph ?? PANEL_H;
  const scx = (sx ?? 0) + (sw ?? 0) / 2;
  const scy = (sy ?? 0) + (sh ?? 0) / 2;
  const dx = scx - (px0 + pw0 / 2);
  const dy = scy - (py0 + ph0 / 2);
  let side: TailSide;
  let offset: number;
  if (Math.abs(dx) >= Math.abs(dy)) {
    side = dx >= 0 ? 'right' : 'left';
    offset = (scy - py0) / ph0;
  } else {
    side = dy >= 0 ? 'bottom' : 'top';
    offset = (scx - px0) / pw0;
  }
  offset = Math.max(0.08, Math.min(0.92, offset));
  return { side, offset };
}

export function syncPanelTailSide(): void {
  const w = panelWindow;
  if (!w || w.isDestroyed() || !w.isVisible()) return;
  w.webContents.send(IPC.panelSetTailSide, computePanelTailPlacement());
}
