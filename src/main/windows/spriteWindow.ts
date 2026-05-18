import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { logger } from '../logger';
import { read, write } from '../storage/store';
import { IPC } from '@shared/ipc-contract';
import { getBubbleWindow, programmaticSetBubblePosition } from './bubbleWindow';
import { getChatPanelWindow, programmaticSetPanelPosition } from './chatPanelWindow';

// Native sprite framesize in clippyjs Merlin pack is 128x128.
const BASE_SPRITE_PX = 128;
const WINDOW_PAD_PX = 32;

export const ZOOM_PRESETS = [1.0, 1.5, 2.0, 3.0] as const;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4.0;

let spriteWindow: BrowserWindow | null = null;
let suppressNextMoves = 0;
let onUserMoveCallback: (() => void) | null = null;
let onResizeCallback: (() => void) | null = null;
let onZoomChangedCallback: ((zoom: number) => void) | null = null;
let onSmoothMoveDoneCallback: (() => void) | null = null;

function programmatic<T>(fn: () => T): T {
  // Counter is decremented by the 'move' event handler. See bubbleWindow for
  // the same pattern + caveat. Internal programmatic moves (setZoom resize)
  // must NOT fire the user-move callback that drags the bubble along.
  suppressNextMoves++;
  return fn();
}

export function setOnSpriteUserMove(cb: (() => void) | null): void {
  onUserMoveCallback = cb;
}

export function setOnSpriteResized(cb: (() => void) | null): void {
  onResizeCallback = cb;
}

export function setOnZoomChanged(cb: ((zoom: number) => void) | null): void {
  onZoomChangedCallback = cb;
}

export function setOnSpriteSmoothMoveDone(cb: (() => void) | null): void {
  onSmoothMoveDoneCallback = cb;
}

function windowSize(zoom: number): { w: number; h: number } {
  const px = Math.round(BASE_SPRITE_PX * zoom) + WINDOW_PAD_PX * 2;
  return { w: px, h: px };
}

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1.0;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

export async function createSpriteWindow(): Promise<BrowserWindow> {
  if (spriteWindow && !spriteWindow.isDestroyed()) return spriteWindow;

  const settings = await read();
  const zoom = clampZoom(settings.zoom);
  const { w, h } = windowSize(zoom);

  const primary = screen.getPrimaryDisplay();
  const { workArea } = primary;
  const x = workArea.x + workArea.width - w - 24;
  const y = workArea.y + workArea.height - h - 24;

  spriteWindow = new BrowserWindow({
    width: w,
    height: h,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/sprite.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  spriteWindow.setAlwaysOnTop(true, 'floating');
  spriteWindow.setVisibleOnAllWorkspaces(true);

  // Forward renderer console to the main terminal so we can debug audio /
  // clippyjs issues without opening DevTools on the transparent window.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (spriteWindow.webContents as any).on(
    'console-message',
    (_e: unknown, _level: number, message: string) => {
      if (typeof message === 'string' && message.includes('[merlin-')) {
        logger.info('[sprite-console]', message);
      }
    },
  );

  spriteWindow.on('move', () => {
    if (suppressNextMoves > 0) {
      suppressNextMoves--;
      return;
    }
    if (onUserMoveCallback) onUserMoveCallback();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void spriteWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/sprite/index.html`);
  } else {
    void spriteWindow.loadFile(join(__dirname, '../renderer/sprite/index.html'));
  }

  spriteWindow.once('ready-to-show', () => {
    spriteWindow?.show();
    // Initial state is pulled by the renderer via getInitial once its IPC
    // handlers are wired — avoids races where we push before listeners exist.
    logger.info('Sprite window shown', { x, y, w, h, zoom });
  });

  spriteWindow.on('closed', () => {
    spriteWindow = null;
  });

  return spriteWindow;
}

export function getSpriteWindow(): BrowserWindow | null {
  return spriteWindow && !spriteWindow.isDestroyed() ? spriteWindow : null;
}

export function showSprite(): void {
  getSpriteWindow()?.show();
}

export function hideSprite(): void {
  getSpriteWindow()?.hide();
}

/** Coerce to a finite integer or null. Guards setPosition against NaN/Infinity */
/** crashing the main process with a native-binding conversion error. */
function safeInt(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(n);
}

export function moveSpriteBy(dx: number, dy: number): void {
  const w = getSpriteWindow();
  if (!w) return;
  const pos = w.getPosition();
  const x = pos[0] ?? 0;
  const y = pos[1] ?? 0;
  const nx = safeInt(x + dx);
  const ny = safeInt(y + dy);
  if (nx === null || ny === null) {
    logger.warn('moveSpriteBy: bad coords, dropping', { x, y, dx, dy });
    return;
  }
  w.setPosition(nx, ny);
}

/** Like moveSpriteBy but suppresses the user-move callback. Use this when */
/** main itself is repositioning the sprite (e.g. to track a bubble drag), */
/** so move-sync doesn't ping-pong. */
export function programmaticMoveSpriteBy(dx: number, dy: number): void {
  const w = getSpriteWindow();
  if (!w) return;
  const pos = w.getPosition();
  const x = pos[0] ?? 0;
  const y = pos[1] ?? 0;
  const nx = safeInt(x + dx);
  const ny = safeInt(y + dy);
  if (nx === null || ny === null) {
    logger.warn('programmaticMoveSpriteBy: bad coords, dropping', { x, y, dx, dy });
    return;
  }
  if (nx === x && ny === y) return; // noop — see programmaticSetSpritePosition comment
  programmatic(() => w.setPosition(nx, ny));
}

export function programmaticSetSpritePosition(x: number, y: number): void {
  const w = getSpriteWindow();
  if (!w) return;
  const nx = safeInt(x);
  const ny = safeInt(y);
  if (nx === null || ny === null) {
    logger.warn('programmaticSetSpritePosition: bad coords, dropping', { x, y });
    return;
  }
  // Skip noop moves — calling setPosition with the SAME coords doesn't fire
  // a move event, so the suppress counter would tick up without ever being
  // decremented, eventually swallowing real user-drag events. This matters
  // for slow smooth moves (brain wander spans ~80px / ~1500ms, so sub-pixel
  // ticks round to the same int many times in a row).
  const [cx, cy] = w.getPosition();
  if ((cx ?? 0) === nx && (cy ?? 0) === ny) return;
  programmatic(() => w.setPosition(nx, ny));
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Smoothly animate the sprite window from current pos to (targetX, targetY). */
/** If the bubble is visible, it moves in lockstep by the same delta so it */
/** stays attached to Merlin throughout the animation. */
export async function smoothMoveSpriteTo(
  targetX: number,
  targetY: number,
  durationMs = 800,
): Promise<void> {
  const w = getSpriteWindow();
  if (!w) return;
  // Validate caller inputs — a NaN/undefined here would propagate through
  // every tick and crash setPosition's native binding (TypeError: conversion
  // failure at index 1).
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
    logger.warn('smoothMoveSpriteTo: invalid target, ignoring', { targetX, targetY });
    return;
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) durationMs = 800;
  const [sx, sy] = w.getPosition();
  const startX = Number.isFinite(sx) ? (sx as number) : 0;
  const startY = Number.isFinite(sy) ? (sy as number) : 0;
  if (Math.abs(startX - targetX) < 2 && Math.abs(startY - targetY) < 2) return;

  // Autonomous-move directional animation: when main initiates a real move
  // (brain wander, move_to / move_relative tool, mode swap), play the
  // matching Move* animation. The sprite isn't being dragged by the user so
  // the renderer-starvation problem doesn't apply — the animation actually
  // renders. Threshold of 40px excludes wiggleSprite (14px ticks) but
  // catches brain wander (up to ~94px) and move_relative small (100px).
  // Note: autonomous moves use direct mapping (drag inverts because the user
  // is yanking him; autonomous moves are Merlin gliding under his own power).
  const moveDist = Math.hypot(targetX - startX, targetY - startY);
  if (moveDist > 40) {
    const dxAuto = targetX - startX;
    const dyAuto = targetY - startY;
    let autoMove: 'MoveLeft' | 'MoveRight' | 'MoveUp' | 'MoveDown';
    if (Math.abs(dxAuto) > Math.abs(dyAuto)) {
      autoMove = dxAuto > 0 ? 'MoveRight' : 'MoveLeft';
    } else {
      autoMove = dyAuto > 0 ? 'MoveDown' : 'MoveUp';
    }
    w.webContents.send(IPC.spritePlay, autoMove);
  }

  // Capture bubble + panel start positions so they can drift alongside by
  // the same delta. Both are tracked because the sprite has two possible
  // companion windows: the bubble (classic mode) and the chat panel (modern
  // mode). If either is visible at the start of the move, it follows.
  const bubble = getBubbleWindow();
  let bubbleStartX = 0;
  let bubbleStartY = 0;
  let bubbleFollows = false;
  if (bubble && bubble.isVisible()) {
    const [bx, by] = bubble.getPosition();
    bubbleStartX = bx ?? 0;
    bubbleStartY = by ?? 0;
    bubbleFollows = true;
  }
  const panel = getChatPanelWindow();
  let panelStartX = 0;
  let panelStartY = 0;
  let panelFollows = false;
  if (panel && panel.isVisible()) {
    const [px, py] = panel.getPosition();
    panelStartX = px ?? 0;
    panelStartY = py ?? 0;
    panelFollows = true;
  }

  const totalDx = targetX - startX;
  const totalDy = targetY - startY;
  const startedAt = Date.now();
  const FRAME_MS = 16;

  return new Promise<void>((resolve) => {
    const tick = (): void => {
      if (!getSpriteWindow()) {
        resolve();
        return;
      }
      const elapsed = Date.now() - startedAt;
      const t = Math.min(1, elapsed / durationMs);
      const ease = easeOutCubic(t);

      programmaticSetSpritePosition(startX + totalDx * ease, startY + totalDy * ease);

      if (bubbleFollows && getBubbleWindow()?.isVisible()) {
        programmaticSetBubblePosition(
          bubbleStartX + totalDx * ease,
          bubbleStartY + totalDy * ease,
        );
      }
      if (panelFollows && getChatPanelWindow()?.isVisible()) {
        programmaticSetPanelPosition(
          panelStartX + totalDx * ease,
          panelStartY + totalDy * ease,
        );
      }

      if (t < 1) {
        setTimeout(tick, FRAME_MS);
      } else {
        onSmoothMoveDoneCallback?.();
        resolve();
      }
    };
    tick();
  });
}

export interface ScreenCorner {
  x: number;
  y: number;
}

/** Compute coords for a named screen corner, accounting for the sprite size */
/** and a margin from edges. */
export function cornerCoords(
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center',
  margin = 24,
): ScreenCorner {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const w = getSpriteWindow();
  const [ww, wh] = w?.getSize() ?? [220, 220];
  const sw = ww ?? 220;
  const sh = wh ?? 220;
  switch (corner) {
    case 'top-left':
      return { x: workArea.x + margin, y: workArea.y + margin };
    case 'top-right':
      return { x: workArea.x + workArea.width - sw - margin, y: workArea.y + margin };
    case 'bottom-left':
      return { x: workArea.x + margin, y: workArea.y + workArea.height - sh - margin };
    case 'bottom-right':
      return {
        x: workArea.x + workArea.width - sw - margin,
        y: workArea.y + workArea.height - sh - margin,
      };
    case 'center':
      return {
        x: workArea.x + Math.round((workArea.width - sw) / 2),
        y: workArea.y + Math.round((workArea.height - sh) / 2),
      };
  }
}

/** Compute a target position for a relative move in a given direction. */
/** "small" = ~100px, "medium" = ~250px, "large" = ~500px. Clamped to the */
/** sprite's current display work-area so Merlin never lands off-screen. */
export function relativeCoords(
  direction: 'left' | 'right' | 'up' | 'down',
  amount: 'small' | 'medium' | 'large' = 'medium',
): ScreenCorner {
  const distance = amount === 'small' ? 100 : amount === 'large' ? 500 : 250;
  const w = getSpriteWindow();
  if (!w) return { x: 0, y: 0 };
  const [sx, sy] = w.getPosition();
  const [sw, sh] = w.getSize();
  const x = sx ?? 0;
  const y = sy ?? 0;
  const ww = sw ?? 220;
  const wh = sh ?? 220;
  let tx = x;
  let ty = y;
  if (direction === 'left') tx = x - distance;
  else if (direction === 'right') tx = x + distance;
  else if (direction === 'up') ty = y - distance;
  else if (direction === 'down') ty = y + distance;
  const display = screen.getDisplayMatching({ x, y, width: ww, height: wh });
  const wa = display.workArea;
  tx = Math.max(wa.x + 8, Math.min(wa.x + wa.width - ww - 8, tx));
  ty = Math.max(wa.y + 8, Math.min(wa.y + wa.height - wh - 8, ty));
  return { x: tx, y: ty };
}

const HIDE_ANIM_MS = 2200;
const SHOW_ANIM_MS = 1500;

/** Play the Hide animation, then actually hide the window. */
export async function hideMerlinWithAnimation(): Promise<void> {
  const w = getSpriteWindow();
  if (!w || !w.isVisible()) return;
  w.webContents.send(IPC.spritePlay, 'Hide');
  await new Promise<void>((res) => setTimeout(res, HIDE_ANIM_MS));
  getSpriteWindow()?.hide();
}

/** Quick left-right shimmy. Bubble follows. Use to physically punctuate */
/** GetAttention or other "look at me" moments. ~400ms total. */
export async function wiggleSprite(): Promise<void> {
  const w = getSpriteWindow();
  if (!w) return;
  const [sx, sy] = w.getPosition();
  const startX = sx ?? 0;
  const startY = sy ?? 0;
  await smoothMoveSpriteTo(startX + 14, startY, 90);
  await smoothMoveSpriteTo(startX - 14, startY, 150);
  await smoothMoveSpriteTo(startX, startY, 100);
}

/** Show the window, then play the Show animation. */
export async function showMerlinWithAnimation(): Promise<void> {
  const w = getSpriteWindow();
  if (!w) return;
  if (!w.isVisible()) w.show();
  await new Promise<void>((res) => setTimeout(res, 60));
  w.webContents.send(IPC.spritePlay, 'Show');
  await new Promise<void>((res) => setTimeout(res, SHOW_ANIM_MS));
}

export async function setZoom(rawZoom: number): Promise<number> {
  const zoom = clampZoom(rawZoom);
  await write({ zoom });

  const w = getSpriteWindow();
  if (!w) return zoom;

  const { w: nw, h: nh } = windowSize(zoom);
  // Resize around the window's current center so Merlin stays roughly put.
  const [cx, cy] = w.getPosition();
  const [cw, ch] = w.getSize();
  const dx = Math.round(((cw ?? nw) - nw) / 2);
  const dy = Math.round(((ch ?? nh) - nh) / 2);
  programmatic(() =>
    w.setBounds({
      x: (cx ?? 0) + dx,
      y: (cy ?? 0) + dy,
      width: nw,
      height: nh,
    }),
  );
  w.webContents.send(IPC.spriteSetZoom, zoom);
  // Notify listeners (move-sync) so the bubble can be re-anchored to the
  // new sprite position.
  onResizeCallback?.();
  onZoomChangedCallback?.(zoom);
  return zoom;
}

export async function zoomBy(delta: number): Promise<number> {
  const current = await getZoom();
  const next = Math.round((current + delta) * 10) / 10;
  return setZoom(next);
}

export async function setMuteSounds(muted: boolean): Promise<boolean> {
  await write({ muteSounds: muted });
  const w = getSpriteWindow();
  w?.webContents.send(IPC.spriteSetMuteSounds, muted);
  logger.info('mute sounds:', muted);
  return muted;
}

export async function getMuteSounds(): Promise<boolean> {
  return (await read()).muteSounds;
}

export async function setVoiceEngine(engine: 'off' | 'sapi' | 'groq' | 'openrouter' | 'edge'): Promise<string> {
  await write({ voiceEngine: engine });
  logger.info('voice engine:', engine);
  return engine;
}

export async function getVoiceEngine(): Promise<'off' | 'sapi' | 'groq' | 'openrouter' | 'edge'> {
  const v = (await read()).voiceEngine ?? 'off';
  if (v === 'sapi' || v === 'groq' || v === 'openrouter' || v === 'edge') return v;
  return 'off';
}

export async function setCharacter(id: string): Promise<string> {
  await write({ character: id });
  // Resolve custom personas (which reuse a built-in sprite pack) to their
  // baseCharacter clippyjs ID before sending to the sprite renderer.
  const { resolveSpriteId } = await import('../customCharacters');
  const spriteId = resolveSpriteId(id);
  // Broadcast to whichever surface is hosting the sprite right now.
  const { getActiveSpriteHost } = await import('../activeSurface');
  const w = await getActiveSpriteHost();
  w?.webContents.send(IPC.spriteSetCharacter, spriteId);
  logger.info('character:', id, spriteId !== id ? `(sprite: ${spriteId})` : '');
  return id;
}

export async function getCharacterId(): Promise<string> {
  return (await read()).character || 'Merlin';
}

export async function getZoom(): Promise<number> {
  const s = await read();
  return clampZoom(s.zoom);
}
