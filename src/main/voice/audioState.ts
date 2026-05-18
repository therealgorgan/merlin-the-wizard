import { ipcMain } from 'electron';
import { IPC } from '@shared/ipc-contract';
import { logger } from '../logger';
import { getChatPanelWindow } from '../windows/chatPanelWindow';

// Tracks whether the sprite renderer is actively playing TTS audio. Updated
// via IPC from sprite/main.ts whenever its audio queue transitions between
// empty and active. Lets the chat-flow layer keep Merlin's 'speaking' state
// alive (and the speaking-gesture cycle running) until the audio actually
// finishes — not just when the LLM stream completes.

let voiceActive = false;
let resolvers: Array<() => void> = [];
let registered = false;

function broadcastToPanel(active: boolean): void {
  const panel = getChatPanelWindow();
  if (!panel || panel.isDestroyed()) return;
  panel.webContents.send(IPC.panelSetAudioActive, active);
}

export function registerAudioStateIpc(): void {
  if (registered) return;
  registered = true;
  ipcMain.handle(IPC.spriteAudioStateChanged, (_e, active: boolean) => {
    const wasActive = voiceActive;
    voiceActive = Boolean(active);
    if (wasActive !== voiceActive) {
      broadcastToPanel(voiceActive);
    }
    if (wasActive && !voiceActive) {
      const pending = resolvers;
      resolvers = [];
      for (const r of pending) {
        try { r(); } catch (err) { logger.warn('voice-idle resolver threw', err); }
      }
    }
  });
}

export function isVoiceActive(): boolean {
  return voiceActive;
}

/** Resolve when the sprite renderer reports its audio queue is drained, or */
/** after `timeoutMs` (so a stuck renderer can't block the caller forever). */
/** Resolves immediately if voice is already idle. */
export function waitForVoiceIdle(timeoutMs = 60_000): Promise<void> {
  if (!voiceActive) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const resolver = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      // Remove our resolver from the list so it doesn't fire later.
      resolvers = resolvers.filter((r) => r !== resolver);
      logger.warn(`waitForVoiceIdle: timed out after ${timeoutMs}ms`);
      resolve();
    }, timeoutMs);
    resolvers.push(resolver);
  });
}

/** Force-mark voice as idle and resolve any pending waiters. Used by */
/** cancelVoice paths where we know the renderer has been told to stop but */
/** might not have sent the state-changed IPC yet. */
export function markVoiceIdle(): void {
  if (!voiceActive) return;
  voiceActive = false;
  broadcastToPanel(false);
  const pending = resolvers;
  resolvers = [];
  for (const r of pending) {
    try { r(); } catch (err) { logger.warn('voice-idle resolver threw', err); }
  }
}
