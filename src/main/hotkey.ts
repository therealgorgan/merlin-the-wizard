import { globalShortcut } from 'electron';
import { IPC } from '@shared/ipc-contract';
import { createSpriteWindow, getSpriteWindow, showSprite } from './windows/spriteWindow';
import { openAskBubble } from './interaction';
import { read as readStore } from './storage/store';
import { captureCurrentScreen } from './screenCapture';
import { logger } from './logger';

let registered: string | null = null;
let screenshotRegistered: string | null = null;

async function fire(): Promise<void> {
  // Make sure Merlin is visible and the ask bubble is open + focused.
  if (!getSpriteWindow()) await createSpriteWindow();
  else showSprite();
  openAskBubble();
}

export async function registerSummonHotkey(): Promise<void> {
  const settings = await readStore();
  const accel = settings.summonHotkey?.trim() || 'Control+Shift+M';

  if (registered === accel) return;
  if (registered) {
    globalShortcut.unregister(registered);
    registered = null;
  }

  try {
    const ok = globalShortcut.register(accel, () => {
      void fire();
    });
    if (ok) {
      registered = accel;
      logger.info('Global hotkey registered:', accel);
    } else {
      logger.warn('Global hotkey registration failed (possibly bound elsewhere):', accel);
    }
  } catch (err) {
    logger.warn('Global hotkey register threw:', err);
  }
}

export async function registerScreenshotHotkey(): Promise<void> {
  const settings = await readStore();
  if (!settings.screenshotHotkeyEnabled) {
    if (screenshotRegistered) {
      globalShortcut.unregister(screenshotRegistered);
      screenshotRegistered = null;
    }
    return;
  }
  const accel = settings.screenshotHotkey?.trim() || 'Control+Shift+S';
  if (screenshotRegistered === accel) return;
  if (screenshotRegistered) {
    globalShortcut.unregister(screenshotRegistered);
    screenshotRegistered = null;
  }
  try {
    const ok = globalShortcut.register(accel, () => {
      void captureCurrentScreen().then((shot) => {
        if (!shot) return;
        // Bubble might be open; notify so a thumb chip can appear.
        import('./windows/bubbleWindow').then(({ getBubbleWindow }) => {
          const b = getBubbleWindow();
          b?.webContents.send(IPC.chatScreenshotReady, {
            width: shot.width, height: shot.height, bytes: shot.bytes,
          });
        });
      });
    });
    if (ok) {
      screenshotRegistered = accel;
      logger.info('Screenshot hotkey registered:', accel);
    } else {
      logger.warn('Screenshot hotkey register failed:', accel);
    }
  } catch (err) {
    logger.warn('Screenshot hotkey register threw:', err);
  }
}

export function unregisterAllHotkeys(): void {
  globalShortcut.unregisterAll();
  registered = null;
  screenshotRegistered = null;
}
