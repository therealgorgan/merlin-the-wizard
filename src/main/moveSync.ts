import { screen, type BrowserWindow } from 'electron';
import {
  getSpriteWindow,
  setOnSpriteUserMove,
  setOnSpriteResized,
  setOnSpriteSmoothMoveDone,
  programmaticMoveSpriteBy,
} from './windows/spriteWindow';
import {
  getBubbleWindow,
  setOnBubbleUserMove,
  setOnBubbleShown,
  programmaticMoveBubbleBy,
  positionRelativeToSprite,
  programmaticSetBubblePosition,
  syncTailSide,
} from './windows/bubbleWindow';
import {
  getChatPanelWindow,
  setOnPanelUserMove,
  programmaticMovePanelBy,
  programmaticSetPanelPosition,
  positionPanelRelativeToSprite,
  syncPanelTailSide,
} from './windows/chatPanelWindow';
import { logger } from './logger';

// Bidirectional drag sync. Each window owns a `suppressNextMoves` counter
// internally (see *Window.ts); they only fire their user-move callback for
// genuine user drags, never for programmatic moves. So this file just listens
// for those callbacks and bridges them.
//
// State: we track the last seen position of each window so we can compute a
// delta on each user-move tick.

let lastSpritePos: [number, number] | null = null;
let lastBubblePos: [number, number] | null = null;
let lastPanelPos: [number, number] | null = null;

function syncSpriteSnapshot(): void {
  const sprite = getSpriteWindow();
  if (!sprite) return;
  const [x, y] = sprite.getPosition();
  lastSpritePos = [x ?? 0, y ?? 0];
}

function syncBubbleSnapshot(): void {
  const bubble = getBubbleWindow();
  if (!bubble) return;
  const [x, y] = bubble.getPosition();
  lastBubblePos = [x ?? 0, y ?? 0];
}

function syncPanelSnapshot(): void {
  const panel = getChatPanelWindow();
  if (!panel) return;
  const [x, y] = panel.getPosition();
  lastPanelPos = [x ?? 0, y ?? 0];
}

export function attachSpriteMoveSync(sprite: BrowserWindow): void {
  syncSpriteSnapshot();

  setOnBubbleShown(() => {
    // After a programmatic reposition (welcome, double-click, etc.), refresh
    // snapshots so the next genuine drag computes the right delta.
    syncSpriteSnapshot();
    syncBubbleSnapshot();
  });

  setOnSpriteResized(() => {
    // Sprite was resized (likely zoom change) and re-centered. The bubble
    // and panel would drift if we left them in place; re-anchor to the sprite.
    const bubble = getBubbleWindow();
    if (bubble && bubble.isVisible()) {
      positionRelativeToSprite();
    }
    const panel = getChatPanelWindow();
    if (panel && panel.isVisible()) {
      positionPanelRelativeToSprite();
      syncPanelTailSide();
    }
    syncSpriteSnapshot();
    syncBubbleSnapshot();
    syncPanelSnapshot();
  });

  setOnSpriteSmoothMoveDone(() => {
    // After a smooth move (move_to tool, brain wander, etc.) sprite + bubble +
    // panel all moved by the same delta in lockstep. Refresh snapshots so the
    // next genuine user drag computes the right delta from the new positions.
    syncSpriteSnapshot();
    syncBubbleSnapshot();
    syncPanelSnapshot();
    // If the glide landed the bubble or panel partly off-screen, flip them to
    // the other side of the sprite (same logic that runs after user drags).
    const bubble = getBubbleWindow();
    if (bubble && bubble.isVisible()) keepBubbleInBounds();
    const panel = getChatPanelWindow();
    if (panel && panel.isVisible()) keepPanelInBounds();
    // Sprite may have landed on the opposite side of the bubble/panel
    // during a long glide.
    syncTailSide();
    syncPanelTailSide();
  });

  setOnSpriteUserMove(() => {
    // Re-resolve the sprite window each tick — the closure-captured `sprite`
    // param can go stale if the window is ever recreated. getSpriteWindow()
    // always returns the current one.
    const current = getSpriteWindow();
    if (!current) return;
    const [x, y] = current.getPosition();
    const prev = lastSpritePos ?? [x ?? 0, y ?? 0];
    const dx = (x ?? 0) - prev[0];
    const dy = (y ?? 0) - prev[1];
    lastSpritePos = [x ?? 0, y ?? 0];
    if (dx === 0 && dy === 0) return;

    // Bubble follows sprite.
    const bubble = getBubbleWindow();
    if (bubble && bubble.isVisible()) {
      programmaticMoveBubbleBy(dx, dy);
      syncBubbleSnapshot();
      // After the lockstep follow, flip the bubble to the other side of the
      // sprite if it landed off-screen.
      keepBubbleInBounds();
      syncTailSide();
    }

    // Chat panel follows sprite too, with the same bounds-aware reposition
    // logic. Only when the panel is actually visible (modern mode).
    const panel = getChatPanelWindow();
    if (panel && panel.isVisible()) {
      programmaticMovePanelBy(dx, dy);
      syncPanelSnapshot();
      keepPanelInBounds();
      syncPanelTailSide();
    }

    if (Math.random() < 0.02) {
      logger.debug('sprite-user-move: dx=%d dy=%d', dx, dy);
    }
  });

  setOnBubbleUserMove(() => {
    const bubble = getBubbleWindow();
    if (!bubble) return;
    const [x, y] = bubble.getPosition();
    const prev = lastBubblePos ?? [x ?? 0, y ?? 0];
    const dx = (x ?? 0) - prev[0];
    const dy = (y ?? 0) - prev[1];
    lastBubblePos = [x ?? 0, y ?? 0];
    if (dx === 0 && dy === 0) return;
    if (sprite.isVisible()) {
      programmaticMoveSpriteBy(dx, dy);
      syncSpriteSnapshot();
      // Same delta on both, so tail side is unchanged — sync for safety.
      syncTailSide();
    }
  });

  // Panel drag → sprite follows (just like bubble drag). Keeps Merlin and his
  // chat surface glued together so the user can reposition the whole cluster
  // by grabbing either window.
  setOnPanelUserMove(() => {
    const panel = getChatPanelWindow();
    if (!panel) return;
    const [x, y] = panel.getPosition();
    const prev = lastPanelPos ?? [x ?? 0, y ?? 0];
    const dx = (x ?? 0) - prev[0];
    const dy = (y ?? 0) - prev[1];
    lastPanelPos = [x ?? 0, y ?? 0];
    if (dx === 0 && dy === 0) return;
    const spriteWin = getSpriteWindow();
    if (spriteWin && spriteWin.isVisible()) {
      programmaticMoveSpriteBy(dx, dy);
      syncSpriteSnapshot();
      // Also drag the bubble along if it's visible (rare in modern mode but
      // possible during a brief overlap window when toggling modes).
      const bubble = getBubbleWindow();
      if (bubble && bubble.isVisible()) {
        programmaticMoveBubbleBy(dx, dy);
        syncBubbleSnapshot();
        syncTailSide();
      }
      // Tail-side unchanged (sprite + panel moved by same delta), but sync
      // anyway so any clamping correction is reflected.
      syncPanelTailSide();
    }
  });
}

/** Called when the bubble is shown for the first time or after being hidden. */
/** Re-snapshots positions so the next move-delta is computed against current */
/** state, not stale data. */
export function refreshMoveSyncSnapshots(): void {
  syncSpriteSnapshot();
  syncBubbleSnapshot();
  syncPanelSnapshot();
}

/** After a sprite drag pulls the bubble along, check if the bubble would
 *  land partly off-screen. If so, flip to the other side of the sprite or
 *  snap to whichever edge keeps the most of the bubble visible. */
function keepBubbleInBounds(): void {
  const bubble = getBubbleWindow();
  const sprite = getSpriteWindow();
  if (!bubble || !sprite) return;
  const [bx, by] = bubble.getPosition();
  const [bw, bh] = bubble.getSize();
  const [sx, sy] = sprite.getPosition();
  const [sw, sh] = sprite.getSize();
  const bx0 = bx ?? 0;
  const by0 = by ?? 0;
  const bw0 = bw ?? 360;
  const bh0 = bh ?? 200;
  const sx0 = sx ?? 0;
  const sy0 = sy ?? 0;
  const sw0 = sw ?? 192;
  const sh0 = sh ?? 192;
  const display = screen.getDisplayMatching({
    x: sx0, y: sy0, width: sw0, height: sh0,
  });
  const wa = display.workArea;
  const MARGIN = 8;
  const GAP = 22;

  let nx = bx0;
  let ny = by0;

  // Horizontal: if bubble crosses the left edge, try the right side of sprite.
  // If it crosses the right edge, try the left side of sprite.
  if (nx < wa.x + MARGIN) {
    // Flip to right side of sprite
    nx = sx0 + sw0 + GAP;
  } else if (nx + bw0 > wa.x + wa.width - MARGIN) {
    // Flip to left side of sprite
    nx = sx0 - bw0 - GAP;
  }
  // Hard clamp horizontal as a fallback
  nx = Math.max(wa.x + MARGIN, Math.min(wa.x + wa.width - bw0 - MARGIN, nx));

  // Vertical: just clamp; don't flip above/below sprite (looks worse).
  ny = Math.max(wa.y + MARGIN, Math.min(wa.y + wa.height - bh0 - MARGIN, ny));

  if (Math.abs(nx - bx0) >= 1 || Math.abs(ny - by0) >= 1) {
    programmaticSetBubblePosition(nx, ny);
    syncBubbleSnapshot();
  }
}

/** Mirrors keepBubbleInBounds for the chat panel. The panel is much larger
 *  than the bubble, so the flip-to-other-side heuristic matters more — when
 *  Merlin gets dragged to a screen corner, the panel almost always needs to
 *  swap sides to stay visible. */
function keepPanelInBounds(): void {
  const panel = getChatPanelWindow();
  const sprite = getSpriteWindow();
  if (!panel || !sprite) return;
  const [px, py] = panel.getPosition();
  const [pw, ph] = panel.getSize();
  const [sx, sy] = sprite.getPosition();
  const [sw, sh] = sprite.getSize();
  const px0 = px ?? 0;
  const py0 = py ?? 0;
  const pw0 = pw ?? 480;
  const ph0 = ph ?? 640;
  const sx0 = sx ?? 0;
  const sy0 = sy ?? 0;
  const sw0 = sw ?? 220;
  const sh0 = sh ?? 220;
  const display = screen.getDisplayMatching({
    x: sx0, y: sy0, width: sw0, height: sh0,
  });
  const wa = display.workArea;
  const MARGIN = 8;
  const GAP = 22;

  let nx = px0;
  let ny = py0;

  if (nx < wa.x + MARGIN) {
    nx = sx0 + sw0 + GAP;
  } else if (nx + pw0 > wa.x + wa.width - MARGIN) {
    nx = sx0 - pw0 - GAP;
  }
  nx = Math.max(wa.x + MARGIN, Math.min(wa.x + wa.width - pw0 - MARGIN, nx));
  ny = Math.max(wa.y + MARGIN, Math.min(wa.y + wa.height - ph0 - MARGIN, ny));

  if (Math.abs(nx - px0) >= 1 || Math.abs(ny - py0) >= 1) {
    programmaticSetPanelPosition(nx, ny);
    syncPanelSnapshot();
  }
}
