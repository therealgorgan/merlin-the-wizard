import { write as writeStore } from './storage/store';
import {
  createSpriteWindow,
  getSpriteWindow,
} from './windows/spriteWindow';
import {
  getBubbleWindow,
  hideBubble,
} from './windows/bubbleWindow';
import {
  createChatPanelWindow,
  getChatPanelWindow,
  hideChatPanel,
  showChatPanel,
} from './windows/chatPanelWindow';
import { logger } from './logger';

// Centralized "switch chat style" path. Both the tray-menu radio toggles AND
// the settings IPC dispatch route through here so they can't fight each other
// or leave both surfaces visible mid-swap. The previous behavior — call
// hideBubble() then showChatPanel() — leaked frames where both were visible
// because the bubble's hide is non-blocking and the panel's show fires
// immediately after.

export type ChatStyle = 'classic' | 'modern';

/** Wait up to `maxMs` for `predicate` to become true, polling at ~16ms. */
/** Returns whether the condition was met before the timeout. */
async function waitFor(predicate: () => boolean, maxMs = 250): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    if (predicate()) return true;
    await new Promise<void>((r) => setTimeout(r, 16));
  }
  return predicate();
}

/** Apply a chat-style change. Hides the currently-visible surface FIRST and
 *  awaits its disappearance, then shows the new one. Persists the choice to
 *  the store. Idempotent — calling with the current style is a no-op (but
 *  it does ensure the sprite is visible and the correct surface is up). */
export async function applyChatStyle(next: ChatStyle): Promise<void> {
  logger.debug('applyChatStyle ->', next);
  await writeStore({ displayMode: next });

  // Sprite is always visible in both modes — ensure it's up.
  const sprite = getSpriteWindow() ?? (await createSpriteWindow());
  if (!sprite.isVisible()) sprite.show();

  if (next === 'classic') {
    // Tear down the panel first so the bubble (which only appears on demand
    // anyway) doesn't briefly overlap if it pops up before the panel is gone.
    const panel = getChatPanelWindow();
    if (panel && panel.isVisible()) {
      hideChatPanel();
      await waitFor(() => !panel.isVisible());
    }
    // Bubble is on-demand — no proactive show. The bubble appears next time
    // there's something to say (welcome, chat reply, idle thought).
  } else {
    // Modern: hide the bubble if it's currently floating, then show the panel.
    const bubble = getBubbleWindow();
    if (bubble && bubble.isVisible()) {
      hideBubble();
      await waitFor(() => !bubble.isVisible());
    }
    // Show the panel. createChatPanelWindow is idempotent; showChatPanel
    // waits for did-finish-load internally.
    createChatPanelWindow();
    showChatPanel();
  }
}
