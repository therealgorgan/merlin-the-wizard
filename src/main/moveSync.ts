import type { BrowserWindow } from 'electron';
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
  syncTailSide,
} from './windows/bubbleWindow';

// Bidirectional drag sync. Each window owns a `suppressNextMoves` counter
// internally (see *Window.ts); they only fire their user-move callback for
// genuine user drags, never for programmatic moves. So this file just listens
// for those callbacks and bridges them.
//
// State: we track the last seen position of each window so we can compute a
// delta on each user-move tick.

let lastSpritePos: [number, number] | null = null;
let lastBubblePos: [number, number] | null = null;

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
    // would drift if we left it in place; re-anchor it to the new sprite.
    const bubble = getBubbleWindow();
    if (bubble && bubble.isVisible()) {
      positionRelativeToSprite();
    }
    syncSpriteSnapshot();
    syncBubbleSnapshot();
  });

  setOnSpriteSmoothMoveDone(() => {
    // After a smooth move (move_to tool, brain wander, etc.) sprite + bubble
    // both moved by the same delta in lockstep. Refresh snapshots so the next
    // genuine user drag computes the right delta from the new positions.
    syncSpriteSnapshot();
    syncBubbleSnapshot();
  });

  setOnSpriteUserMove(() => {
    const [x, y] = sprite.getPosition();
    const prev = lastSpritePos ?? [x ?? 0, y ?? 0];
    const dx = (x ?? 0) - prev[0];
    const dy = (y ?? 0) - prev[1];
    lastSpritePos = [x ?? 0, y ?? 0];
    if (dx === 0 && dy === 0) return;
    const bubble = getBubbleWindow();
    if (!bubble) return;
    // Always shift the bubble in lockstep — even if it's not currently visible.
    // A hidden bubble stays glued to its original relative position so that
    // when it next shows, no jump happens. Previously this guard required
    // isVisible(), which could return false on the first drag tick immediately
    // after showInactive(), causing the idle-thought bubble to never sync.
    programmaticMoveBubbleBy(dx, dy);
    syncBubbleSnapshot();
    syncTailSide();
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
}

/** Called when the bubble is shown for the first time or after being hidden. */
/** Re-snapshots positions so the next move-delta is computed against current */
/** state, not stale data. */
export function refreshMoveSyncSnapshots(): void {
  syncSpriteSnapshot();
  syncBubbleSnapshot();
}
