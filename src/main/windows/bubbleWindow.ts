import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { IPC, type TailPlacement, type TailSide } from '@shared/ipc-contract';
import { getSpriteWindow } from './spriteWindow';
import { logger } from '../logger';

const BUBBLE_W = 360;
const GAP = 22;
const HEIGHT_READ = 200;
const HEIGHT_ASK = 340;

export type BubbleMode = 'read' | 'ask';

let bubbleWindow: BrowserWindow | null = null;
let hideTimer: NodeJS.Timeout | null = null;
let onUserMoveCallback: (() => void) | null = null;
let onShownCallback: (() => void) | null = null;
let suppressNextMoves = 0;

function programmatic<T>(fn: () => T): T {
  // Counter is decremented in the bubble's 'move' event handler. We rely on
  // each setPosition/setBounds emitting exactly one move event; if it emits
  // zero (e.g. same coords), the counter stays high until the next real move
  // depletes it — at worst one user drag tick is missed, never a phantom move.
  suppressNextMoves++;
  return fn();
}

export function createBubbleWindow(): BrowserWindow {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) return bubbleWindow;

  bubbleWindow = new BrowserWindow({
    width: BUBBLE_W,
    height: HEIGHT_READ,
    minWidth: 260,
    minHeight: 140,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/bubble.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });

  bubbleWindow.setAlwaysOnTop(true, 'floating');

  // Allow microphone access for the Whisper push-to-talk feature.
  bubbleWindow.webContents.session.setPermissionRequestHandler(
    (_wc, permission, callback) => {
      if (permission === 'media') {
        callback(true);
        return;
      }
      callback(false);
    },
  );

  bubbleWindow.on('move', () => {
    if (suppressNextMoves > 0) {
      suppressNextMoves--;
      return;
    }
    if (onUserMoveCallback) onUserMoveCallback();
  });

  // The OS 'show' event fires reliably once the window is actually visible.
  // moveSync listens here to refresh its sprite/bubble position snapshots so
  // that the very first sprite-drag tick after the bubble appears computes
  // the right delta. (onShownCallback inside showBubble() can fire a beat
  // too early on Windows — isVisible() may still be false there.)
  bubbleWindow.on('show', () => {
    onShownCallback?.();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void bubbleWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/bubble/index.html`);
  } else {
    void bubbleWindow.loadFile(join(__dirname, '../renderer/bubble/index.html'));
  }

  bubbleWindow.on('closed', () => {
    bubbleWindow = null;
  });

  return bubbleWindow;
}

export function setOnBubbleUserMove(cb: (() => void) | null): void {
  onUserMoveCallback = cb;
}

export function setOnBubbleShown(cb: (() => void) | null): void {
  onShownCallback = cb;
}

export function positionRelativeToSprite(): void {
  const w = bubbleWindow;
  if (!w) return;
  const sprite = getSpriteWindow();
  if (!sprite) return;
  const [sx, sy] = sprite.getPosition();
  const [sw] = sprite.getSize();
  const [, bh] = w.getSize();

  let x = (sx ?? 0) - BUBBLE_W - GAP;
  let y = (sy ?? 0) - 24;

  const display = screen.getDisplayMatching({
    x: sx ?? 0,
    y: sy ?? 0,
    width: sw ?? 0,
    height: 1,
  });
  const wa = display.workArea;
  if (x < wa.x) {
    x = (sx ?? 0) + (sw ?? 0) + GAP;
  }
  if (y < wa.y) y = wa.y + 8;
  if (y + (bh ?? HEIGHT_READ) > wa.y + wa.height) {
    y = wa.y + wa.height - (bh ?? HEIGHT_READ) - 8;
  }

  programmatic(() => w.setPosition(Math.round(x), Math.round(y)));
  // Position relative to sprite changed, so tail side may need to flip.
  syncTailSide();
}

function setHeightForMode(mode: BubbleMode): void {
  const w = bubbleWindow;
  if (!w) return;
  const target = mode === 'ask' ? HEIGHT_ASK : HEIGHT_READ;
  const [cx, cy] = w.getPosition();
  const [cw] = w.getSize();
  programmatic(() =>
    w.setBounds({ x: cx ?? 0, y: cy ?? 0, width: cw ?? BUBBLE_W, height: target }),
  );
}

export function showBubble(
  text: string,
  opts: { mode?: BubbleMode; durationMs?: number; reposition?: boolean } = {},
): void {
  const { mode = 'read', durationMs = 12_000, reposition = true } = opts;
  const w = createBubbleWindow();

  const send = (): void => {
    setHeightForMode(mode);
    w.webContents.send(IPC.bubbleSetText, { text, mode });
    if (reposition) positionRelativeToSprite();
    // Defer the actual show by one frame (~16ms) so the renderer can process
    // the setText IPC and paint the new content BEFORE the window becomes
    // visible. Otherwise the OS shows the window with whatever was in the
    // DOM previously (often empty after a hideBubble → setText('')) for one
    // frame, producing the "bubble appears too early / empty" flash.
    const reveal = (): void => {
      // Ask mode needs window focus so keystrokes reach the input. Read mode
      // (welcome, streaming reply) uses showInactive to avoid stealing focus
      // from whatever the user was doing.
      if (mode === 'ask') {
        w.show();
        w.focus();
      } else {
        w.showInactive();
      }
      onShownCallback?.();
      syncTailSide();
      logger.debug('bubble shown', { mode, text: text.slice(0, 60), durationMs });
    };
    setTimeout(reveal, 16);
  };

  if (w.webContents.isLoading()) {
    w.webContents.once('did-finish-load', send);
  } else {
    send();
  }

  if (hideTimer) clearTimeout(hideTimer);
  // In 'ask' mode the bubble stays open until the user submits or dismisses.
  if (mode !== 'ask' && durationMs > 0) {
    hideTimer = setTimeout(() => hideBubble(), durationMs);
  }
}

export function hideBubble(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  bubbleWindow?.hide();
}

export function getBubbleWindow(): BrowserWindow | null {
  return bubbleWindow && !bubbleWindow.isDestroyed() ? bubbleWindow : null;
}

function safeInt(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(n);
}

/** Move the bubble by (dx, dy) without firing the user-move callback. */
export function programmaticMoveBubbleBy(dx: number, dy: number): void {
  const w = bubbleWindow;
  if (!w || w.isDestroyed()) return;
  const [x, y] = w.getPosition();
  const cx = x ?? 0;
  const cy = y ?? 0;
  const nx = safeInt(cx + dx);
  const ny = safeInt(cy + dy);
  if (nx === null || ny === null) {
    logger.warn('programmaticMoveBubbleBy: bad coords, dropping', { x, y, dx, dy });
    return;
  }
  // Noop skip: see programmaticSetSpritePosition for the counter-leak issue.
  if (nx === cx && ny === cy) return;
  programmatic(() => w.setPosition(nx, ny));
}

/** Set the bubble's absolute position without firing the user-move callback. */
export function programmaticSetBubblePosition(x: number, y: number): void {
  const w = bubbleWindow;
  if (!w || w.isDestroyed()) return;
  const nx = safeInt(x);
  const ny = safeInt(y);
  if (nx === null || ny === null) {
    logger.warn('programmaticSetBubblePosition: bad coords, dropping', { x, y });
    return;
  }
  const [cx, cy] = w.getPosition();
  if ((cx ?? 0) === nx && (cy ?? 0) === ny) return;
  programmatic(() => w.setPosition(nx, ny));
}

/** Compute the bubble's tail placement so it actually points at Merlin. The */
/** side (left/right/top/bottom) is the dominant axis from bubble center to */
/** sprite center. The offset is a 0-1 fraction along that side, mapped from */
/** the sprite's center position relative to the bubble's edge, so the tail */
/** slides along to track Merlin even when he isn't aligned with the bubble. */
function computeTailPlacement(): TailPlacement {
  const w = bubbleWindow;
  const sprite = getSpriteWindow();
  if (!w || !sprite) return { side: 'right', offset: 0.5 };
  const [bx, by] = w.getPosition();
  const [bw, bh] = w.getSize();
  const [sx, sy] = sprite.getPosition();
  const [sw, sh] = sprite.getSize();
  const bx0 = bx ?? 0;
  const by0 = by ?? 0;
  const bw0 = bw ?? 360;
  const bh0 = bh ?? 200;
  const scx = (sx ?? 0) + (sw ?? 0) / 2;
  const scy = (sy ?? 0) + (sh ?? 0) / 2;
  const dx = scx - (bx0 + bw0 / 2);
  const dy = scy - (by0 + bh0 / 2);
  let side: TailSide;
  let offset: number;
  if (Math.abs(dx) >= Math.abs(dy)) {
    side = dx >= 0 ? 'right' : 'left';
    // Vertical offset along the bubble's side edge, tracking Merlin's center.
    offset = (scy - by0) / bh0;
  } else {
    side = dy >= 0 ? 'bottom' : 'top';
    // Horizontal offset along the bubble's top/bottom edge.
    offset = (scx - bx0) / bw0;
  }
  // Clamp so the tail never falls off the bubble's rounded corners.
  offset = Math.max(0.1, Math.min(0.9, offset));
  return { side, offset };
}

export function syncTailSide(): void {
  const w = bubbleWindow;
  if (!w || w.isDestroyed() || !w.isVisible()) return;
  w.webContents.send(IPC.bubbleSetTailSide, computeTailPlacement());
}

/** Append text chunks (streaming responses). */
export function appendBubbleText(text: string): void {
  const w = bubbleWindow;
  if (!w || w.isDestroyed()) return;
  w.webContents.send(IPC.bubbleAppendText, text);
}

/** Switch bubble mode without resetting the displayed text. */
export function setBubbleMode(mode: BubbleMode): void {
  const w = bubbleWindow;
  if (!w || w.isDestroyed()) return;
  setHeightForMode(mode);
  w.webContents.send(IPC.bubbleSetMode, mode);
  if (mode === 'ask' && w.isVisible()) {
    w.focus();
  }
}

/** Send a list of suggested follow-ups (rendered as chips). Empty clears. */
export function setBubbleSuggestions(items: string[]): void {
  const w = bubbleWindow;
  if (!w || w.isDestroyed()) return;
  w.webContents.send(IPC.bubbleSetSuggestions, items);
}
