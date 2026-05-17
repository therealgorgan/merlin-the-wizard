import type { BrowserWindow } from 'electron';
import { read as readStore } from './storage/store';
import { getSpriteWindow } from './windows/spriteWindow';

// The active sprite surface is always the standalone sprite window. In both
// classic and modern modes the sprite is a free-floating window — modern just
// also shows a docked chat panel alongside it. Animations, voice playback,
// and character changes always route to the sprite window.

export type DisplayMode = 'classic' | 'modern';

export async function getDisplayMode(): Promise<DisplayMode> {
  const s = await readStore();
  return s.displayMode === 'modern' ? 'modern' : 'classic';
}

export async function getActiveSpriteHost(): Promise<BrowserWindow | null> {
  return getSpriteWindow();
}

export function getActiveSpriteHostSync(_modeHint: DisplayMode): BrowserWindow | null {
  return getSpriteWindow();
}
