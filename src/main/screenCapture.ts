import { desktopCapturer, screen, Notification } from 'electron';
import { logger } from './logger';

// Pending screenshot — captured via global hotkey, sent with the user's next
// chat prompt as an image content part for vision-capable models.

export interface PendingScreenshot {
  dataUrl: string;       // image/png;base64,...
  bytes: number;
  capturedAt: number;
  width: number;
  height: number;
}

let pending: PendingScreenshot | null = null;

export function getPendingScreenshot(): PendingScreenshot | null {
  return pending;
}

export function clearPendingScreenshot(): void {
  pending = null;
}

export function consumePendingScreenshot(): PendingScreenshot | null {
  const p = pending;
  pending = null;
  return p;
}

/**
 * Capture the primary screen (or the screen the cursor is on) at a reasonable
 * resolution and stash it as the pending screenshot. Triggered by the global
 * Ctrl+Shift+S hotkey.
 */
export async function captureCurrentScreen(): Promise<PendingScreenshot | null> {
  try {
    const cursor = screen.getCursorScreenPoint();
    const target = screen.getDisplayNearestPoint(cursor);
    // Capture at native resolution capped at 1600x1000 — enough detail for
    // vision models but not absurdly large.
    const maxW = 1600;
    const maxH = 1000;
    const scale = Math.min(maxW / target.size.width, maxH / target.size.height, 1);
    const w = Math.round(target.size.width * scale);
    const h = Math.round(target.size.height * scale);

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: w, height: h },
    });
    if (sources.length === 0) {
      logger.warn('captureCurrentScreen: no sources');
      return null;
    }
    // Pick the source whose display_id matches the target screen, else first.
    const targetSource =
      sources.find((s) => s.display_id === String(target.id)) ?? sources[0]!;
    const thumb = targetSource.thumbnail;
    if (thumb.isEmpty()) {
      logger.warn('captureCurrentScreen: empty thumbnail');
      return null;
    }
    const pngBuf = thumb.toPNG();
    const dataUrl = `data:image/png;base64,${pngBuf.toString('base64')}`;
    pending = {
      dataUrl,
      bytes: pngBuf.length,
      capturedAt: Date.now(),
      width: w,
      height: h,
    };
    logger.info('screenshot captured:', w, 'x', h, '(', pngBuf.length, 'bytes )');

    try {
      const n = new Notification({
        title: 'Merlin',
        body: `Screen captured — ask Merlin about it. (${w}×${h})`,
        silent: true,
      });
      n.show();
    } catch {
      // notifications optional
    }
    return pending;
  } catch (err) {
    logger.warn('captureCurrentScreen failed', err);
    return null;
  }
}
