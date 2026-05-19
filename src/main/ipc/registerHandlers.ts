import { ipcMain, shell } from 'electron';
import { IPC, type StoreSnapshot } from '@shared/ipc-contract';
import { type AnimationName, isAnimationName } from '@shared/animations';
import {
  createSpriteWindow,
  getSpriteWindow,
  hideSprite,
  moveSpriteBy,
  setZoom,
  showSprite,
  zoomBy,
} from '../windows/spriteWindow';
import { hideBubble } from '../windows/bubbleWindow';
import { closeSettingsWindow, openSettingsWindow } from '../windows/settingsWindow';
import { buildMerlinMenu } from '../contextMenu';
import { openAskBubble, handleUserMessage } from '../interaction';
import { read as readStore, write as writeStore, type StoreData } from '../storage/store';
import {
  customCharactersDir,
  getAllCharacters,
  loadCustomCharacters,
} from '../customCharacters';
import {
  registerScreenshotHotkey as reRegisterScreenshotHotkey,
  registerSummonHotkey as reRegisterSummonHotkey,
} from '../hotkey';
import { setAutoStart } from '../autostart';
import { clearSecret, hasSecret, setSecret } from '../storage/secrets';
import { PROVIDERS } from '../llm/providerRegistry';
import { getSapiVoices } from '../voice/sapi';
import { transcribeAudio } from '../voice/whisper';
import {
  discoverAllHermesProfiles,
  getCachedHermesProfiles,
  setActiveHermesProfile,
  type HermesProfile,
} from '../hermesDiscovery';
import { attachFile, clearPending, pendingCount } from '../attachments';
import {
  captureCurrentScreen,
  clearPendingScreenshot,
  getPendingScreenshot,
} from '../screenCapture';
import {
  createChatPanelWindow,
  getChatPanelWindow,
  hideChatPanel,
  showChatPanel,
} from '../windows/chatPanelWindow';
import { getActiveSpriteHost } from '../activeSurface';
import { loadHistory, getHistorySnapshot } from '../storage/conversationStore';
import { registerAudioStateIpc } from '../voice/audioState';
import { logger } from '../logger';

export function registerIpcHandlers(): void {
  // Renderer-side audio-queue state updates feed the speaking-cycle gate.
  registerAudioStateIpc();

  ipcMain.handle(IPC.spritePlay, async (_e, name: string) => {
    if (!isAnimationName(name)) {
      logger.warn('Rejecting unknown animation', name);
      return;
    }
    const w = getSpriteWindow() ?? (await createSpriteWindow());
    w.webContents.send(IPC.spritePlay, name as AnimationName);
  });

  ipcMain.handle(IPC.spriteShow, () => showSprite());
  ipcMain.handle(IPC.spriteHide, () => hideSprite());
  ipcMain.handle(IPC.spriteSetZoom, async (_e, zoom: number) => setZoom(zoom));
  ipcMain.handle(IPC.spriteZoomBy, async (_e, delta: number) => {
    zoomBy(delta);
    const { reactToZoom } = await import('../animationController');
    reactToZoom();
  });

  ipcMain.handle(IPC.spriteGetInitial, async () => {
    const s = await readStore();
    const { resolveSpriteId } = await import('../customCharacters');
    const { snapshotForRenderer } = await import('../extensions');
    return {
      zoom: typeof s.zoom === 'number' ? s.zoom : 1.0,
      muteSounds: Boolean(s.muteSounds),
      character: resolveSpriteId(s.character || 'Merlin'),
      appearance: s.appearance === 'retouched' ? 'retouched' as const : 'classic' as const,
      extensions: snapshotForRenderer(),
    };
  });

  ipcMain.handle(IPC.spriteDoubleClicked, () => {
    openAskBubble();
  });

  ipcMain.handle(IPC.spriteRightClicked, async () => {
    const sprite = getSpriteWindow();
    if (!sprite) return;
    const { reactToRightClick } = await import('../animationController');
    reactToRightClick();
    const menu = await buildMerlinMenu({
      askMerlin: () => openAskBubble(),
    });
    menu.popup({ window: sprite });
  });

  ipcMain.handle(IPC.bubbleSubmit, (_e, text: string) => {
    handleUserMessage(text);
  });

  ipcMain.handle(IPC.bubbleDismiss, () => {
    hideBubble();
  });

  ipcMain.handle(IPC.chatAttachFile, async (_e, path: string) => {
    const res = await attachFile(path);
    if (res.ok) return { ok: true, name: res.attachment.name };
    return { ok: false, error: res.error };
  });

  ipcMain.handle(IPC.chatPendingCount, () => pendingCount());
  ipcMain.handle(IPC.chatClearPending, () => clearPending());

  ipcMain.handle(
    IPC.chatTranscribeAudio,
    async (_e, audioBase64: string, mime: string) => {
      return transcribeAudio(audioBase64, mime);
    },
  );

  ipcMain.handle(IPC.chatHistory, async () => {
    await loadHistory();
    return getHistorySnapshot();
  });

  // ----- Chat panel (modern mode) -----

  ipcMain.handle(IPC.panelSubmit, async (_e, text: string) => {
    handleUserMessage(text);
  });

  ipcMain.handle(IPC.panelStop, async () => {
    const { dismissBubble } = await import('../interaction');
    // Reuse the same abort+cancel-voice path the bubble close uses.
    dismissBubble();
  });

  ipcMain.handle(IPC.panelDismissIdleThought, async (_e, id: string) => {
    // The renderer removes the thought from its own UI; this notifies main so
    // brain can reset its "last thought emitted" cooldown — without it, brain
    // would happily fire another thought immediately, defeating the purpose
    // of the user dismissing the first.
    const { noteIdleThoughtDismissed } = await import('../brain');
    noteIdleThoughtDismissed(id);
  });

  ipcMain.handle(IPC.panelRegenerate, async () => {
    await loadHistory();
    const history = getHistorySnapshot();
    // Walk backwards to find the most recent user turn.
    for (let i = history.length - 1; i >= 0; i--) {
      const t = history[i];
      if (t?.role === 'user') {
        handleUserMessage(t.content);
        return;
      }
    }
  });

  ipcMain.handle(IPC.panelGetInitial, async () => {
    await loadHistory();
    const settings = await readStore();
    const { resolveSpriteId } = await import('../customCharacters');
    const character = resolveSpriteId(settings.character || 'Merlin');
    const { stripAllTags } = await import('@shared/animation-protocol');
    // History was saved with raw [anim:...]/[feel:...]/[suggest:...] tags +
    // any italic action narration the model emitted. Strip both before
    // shipping to the panel so users see clean text in the thread.
    const cleanForDisplay = (raw: string): string => {
      let s = stripAllTags(raw);
      // Strip italic-action spans (same verbs the streaming filter uses).
      s = s.replace(
        /\*\s*(slides?|slid|walks?|walked|walking|runs?|ran|running|moves?|moved|moving|glides?|glided|gliding|floats?|floated|floating|hops?|hopped|hopping|flies|flew|flown|flying|sits?|sat|sitting|stands?|stood|standing|hides?|hid|hiding|vanish(?:es|ed|ing)?|drifts?|drifted|drifting|scoots?|scooted|scooting|leans?|leaned|leaning|points?|pointed|pointing|gestures?|gestured|gesturing|bows?|bowed|bowing|spins?|spun|spinning|twirls?|twirled|twirling|dances?|danced|dancing|steps?|stepped|stepping|prances?|pranced|prancing|swoops?|swooped|swooping|sails?|sailed|sailing|rises?|rose|risen|rising|falls?|fell|fallen|falling|jumps?|jumped|jumping|marches?|marched|marching|skips?|skipped|skipping|sashays|sashayed|sashaying|struts?|strutted|strutting|paces?|paced|pacing|appears?|appeared|appearing|disappears?|disappeared|disappearing|reappears?|reappeared|reappearing|lifts?|lifted|lifting|drops?|dropped|dropping|swirls?|swirled|swirling|saunters?|sauntered|sauntering|wanders?|wandered|wandering|teleports?|teleported|teleporting|materializes?|materialized|materializing|nods?|nodded|nodding|waves?|waved|waving|claps?|clapped|clapping|conjures?|conjured|conjuring|casts?|casted|casting|flourish(?:es|ed|ing)?|smiles?|smiled|smiling|looks?|looked|looking|peeks?|peeked|peeking|tilts?|tilted|tilting|stretches?|stretched|stretching|shakes?|shook|shaking)\b[^*\n]{0,200}\*/gi,
        ''
      );
      // Collapse multi-newline gaps left behind by stripped tags/narration.
      return s.replace(/\n{3,}/g, '\n\n').trim();
    };
    return {
      character,
      history: getHistorySnapshot().map((t, i) => ({
        id: `h-${i}-${t.timestamp}`,
        role: t.role,
        content: t.role === 'assistant' ? cleanForDisplay(t.content) : t.content,
        timestamp: t.timestamp,
      })),
    };
  });

  ipcMain.handle(IPC.chatCaptureScreen, async () => {
    const shot = await captureCurrentScreen();
    if (!shot) return { ok: false };
    return { ok: true, width: shot.width, height: shot.height };
  });

  ipcMain.handle(IPC.chatPendingScreenshot, () => {
    const s = getPendingScreenshot();
    return s ? { width: s.width, height: s.height, bytes: s.bytes } : null;
  });

  ipcMain.handle(IPC.chatClearScreenshot, () => {
    clearPendingScreenshot();
  });

  // Drag events: per-frame deltas drive the sprite window movement AND feed
  // the AnimationController. Drag-end is signalled EXPLICITLY by the renderer
  // on pointerup (not inferred from delta absence) so the Move* animation
  // keeps playing while the user holds the button down without moving.
  // A held-drag heartbeat re-fires the last Move* every ~2.4s so the gesture
  // stays continuous instead of finishing once and going still.
  let dragActive = false;
  let dragHeartbeat: NodeJS.Timeout | null = null;
  let dragSafetyTimer: NodeJS.Timeout | null = null;
  const DRAG_SAFETY_TIMEOUT_MS = 6_000;
  const DRAG_HEARTBEAT_MS = 2_400;

  // setPosition throttling. Per-IPC moves at 60Hz freeze the sprite renderer's
  // paint pipeline (Chromium-on-Windows defers content paint while a window
  // is being moved). Accumulate deltas and flush at ~30Hz instead — halves
  // the OS-level move events and gives clippyjs's setTimeout-driven frame
  // cycling room to actually render MoveUp's frames during the drag.
  let pendingMoveDx = 0;
  let pendingMoveDy = 0;
  let moveFlushTimer: NodeJS.Timeout | null = null;
  const MOVE_FLUSH_MS = 33;

  function flushPendingMove(): void {
    moveFlushTimer = null;
    if (pendingMoveDx === 0 && pendingMoveDy === 0) return;
    const dx = pendingMoveDx;
    const dy = pendingMoveDy;
    pendingMoveDx = 0;
    pendingMoveDy = 0;
    moveSpriteBy(dx, dy);
  }

  function scheduleMoveFlush(): void {
    if (moveFlushTimer) return;
    moveFlushTimer = setTimeout(flushPendingMove, MOVE_FLUSH_MS);
  }

  function clearDragTimers(): void {
    if (dragHeartbeat) { clearInterval(dragHeartbeat); dragHeartbeat = null; }
    if (dragSafetyTimer) { clearTimeout(dragSafetyTimer); dragSafetyTimer = null; }
    if (moveFlushTimer) { clearTimeout(moveFlushTimer); moveFlushTimer = null; }
  }

  async function endDrag(): Promise<void> {
    if (!dragActive) return;
    dragActive = false;
    // Flush any leftover delta so the final landing position is exact.
    flushPendingMove();
    clearDragTimers();
    const m = await import('../animationController');
    m.reactToDragEnd();
  }

  ipcMain.handle(IPC.windowDrag, async (_e, payload: { dx: number; dy: number }) => {
    pendingMoveDx += payload.dx;
    pendingMoveDy += payload.dy;
    scheduleMoveFlush();
    const anim = await import('../animationController');
    if (!dragActive) {
      dragActive = true;
      anim.reactToDragStart();
      // Heartbeat: while dragActive, re-fire the most-recent directional
      // Move* animation so it stays alive even if the user stops moving the
      // cursor mid-drag (mouse held still = no further dx/dy events).
      dragHeartbeat = setInterval(() => {
        if (dragActive) anim.repeatLastDragAnim();
      }, DRAG_HEARTBEAT_MS);
    }
    anim.reactToDrag(payload.dx, payload.dy);
    // Safety net: if the renderer crashes or windowDragEnd somehow doesn't
    // arrive (e.g. window closed mid-drag), the dragActive flag would stick.
    // This timer ends the drag if no drag delta has arrived in 6s.
    if (dragSafetyTimer) clearTimeout(dragSafetyTimer);
    dragSafetyTimer = setTimeout(() => void endDrag(), DRAG_SAFETY_TIMEOUT_MS);
  });

  ipcMain.handle(IPC.windowDragEnd, async () => {
    await endDrag();
  });

  // ----- Settings IPC -----

  const snapshot = (s: StoreData): StoreSnapshot => ({
    llmProvider: s.llmProvider,
    llmModel: s.llmModel,
    ollamaEndpoint: s.ollamaEndpoint,
    hermesEndpoint: s.hermesEndpoint,
    voiceEngine: s.voiceEngine,
    voiceName: s.voiceName,
    character: s.character,
    userName: s.userName,
    summonHotkey: s.summonHotkey,
    autoStart: s.autoStart,
    idleThoughtsEnabled: s.idleThoughtsEnabled,
    showWelcomeOnStart: s.showWelcomeOnStart,
    speakWelcome: s.speakWelcome,
    screenshotHotkey: s.screenshotHotkey,
    screenshotHotkeyEnabled: s.screenshotHotkeyEnabled,
    displayMode: s.displayMode,
    appearance: s.appearance === 'retouched' ? 'retouched' : 'classic',
    extensions: s.extensions ?? {},
    brainController: s.brainController ?? 'default',
    brainControllerConfig: s.brainControllerConfig ?? {},
  });

  ipcMain.handle(IPC.settingsGet, async () => snapshot(await readStore()));

  ipcMain.handle(IPC.settingsSet, async (_e, patch: Partial<StoreData>) => {
    const prev = await readStore();
    const updated = await writeStore(patch);

    // Side effects for changed fields. The tray menu uses dedicated setter
    // helpers (setCharacter, setMuteSounds, ...) that fire the IPC events
    // the renderer needs. The settings UI writes through this generic path,
    // so mirror those side effects here.
    const sprite = getSpriteWindow();
    if (patch.character !== undefined && patch.character !== prev.character) {
      const { resolveSpriteId } = await import('../customCharacters');
      const spriteId = resolveSpriteId(patch.character);
      sprite?.webContents.send(IPC.spriteSetCharacter, spriteId);
      logger.info('character ->', patch.character, spriteId !== patch.character ? `(sprite: ${spriteId})` : '');
    }
    if (patch.muteSounds !== undefined && patch.muteSounds !== prev.muteSounds) {
      sprite?.webContents.send(IPC.spriteSetMuteSounds, patch.muteSounds);
    }
    if (
      patch.voiceEngine !== undefined &&
      patch.voiceEngine !== prev.voiceEngine &&
      patch.voiceEngine === 'off'
    ) {
      // Switching to off mid-stream: stop any in-flight TTS playback.
      const { cancelVoice } = await import('../voice/tts');
      cancelVoice();
    }
    if (patch.summonHotkey !== undefined && patch.summonHotkey !== prev.summonHotkey) {
      await reRegisterSummonHotkey();
    }
    if (
      (patch.screenshotHotkey !== undefined && patch.screenshotHotkey !== prev.screenshotHotkey) ||
      (patch.screenshotHotkeyEnabled !== undefined &&
        patch.screenshotHotkeyEnabled !== prev.screenshotHotkeyEnabled)
    ) {
      await reRegisterScreenshotHotkey();
    }
    if (patch.autoStart !== undefined && patch.autoStart !== prev.autoStart) {
      await setAutoStart(patch.autoStart);
    }
    if (patch.appearance !== undefined && patch.appearance !== prev.appearance) {
      const sprite2 = getSpriteWindow();
      sprite2?.webContents.send(IPC.spriteSetAppearance, patch.appearance);
      logger.info('appearance ->', patch.appearance);
    }
    if (patch.displayMode !== undefined && patch.displayMode !== prev.displayMode) {
      logger.info('displayMode ->', patch.displayMode);
      // Route through the shared helper so the tray-toggle path and the
      // settings-IPC path can't fight each other. Helper handles
      // hide-old-then-await-then-show-new + ensures sprite is visible.
      const { applyChatStyle } = await import('../chatSurface');
      await applyChatStyle(patch.displayMode);
    }
    if (patch.extensions !== undefined) {
      // Invalidate the sync cache so the next isEnabled()/getValue() reads
      // fresh values. Then broadcast the new flag snapshot to the sprite
      // renderer so CSS-side gates (drag halo, sway, etc.) update without
      // a window reload.
      const { invalidateExtensionsCache, snapshotForRenderer, warmExtensionsCache } =
        await import('../extensions');
      invalidateExtensionsCache();
      await warmExtensionsCache();
      const sprite3 = getSpriteWindow();
      sprite3?.webContents.send(IPC.spriteSetExtensions, snapshotForRenderer());
    }
    if (patch.brainController !== undefined && patch.brainController !== prev.brainController) {
      logger.info('brainController ->', patch.brainController);
      const { swapBrain } = await import('../brainSupervisor');
      await swapBrain();
    }

    return snapshot(updated);
  });

  ipcMain.handle(IPC.settingsGetSapiVoices, async () => {
    return getSapiVoices();
  });

  ipcMain.handle(IPC.settingsGetProviderInfo, async () => {
    return Object.values(PROVIDERS).map((p) => ({
      id: p.id,
      displayName: p.displayName,
      suggestedModels: p.suggestedModels,
      defaultModel: p.defaultModel,
      needsApiKey: p.needsApiKey,
      secretName: p.secretName,
      keyHelpUrl: p.keyHelpUrl,
    }));
  });

  function characterListForUi(): Array<{
    id: string; displayName: string; description: string;
    custom: boolean; baseCharacter?: string;
  }> {
    return getAllCharacters().map((c) => {
      const custom = (c as { custom?: boolean }).custom === true;
      const baseCharacter = (c as { baseCharacter?: string }).baseCharacter;
      const base = {
        id: c.id, displayName: c.displayName, description: c.description, custom,
      };
      return baseCharacter ? { ...base, baseCharacter } : base;
    });
  }

  ipcMain.handle(IPC.settingsGetCharacters, () => characterListForUi());

  ipcMain.handle(IPC.settingsReloadCharacters, async () => {
    await loadCustomCharacters();
    return characterListForUi();
  });

  ipcMain.handle(IPC.settingsOpenCharactersFolder, async () => {
    const dir = customCharactersDir();
    try {
      await import('node:fs').then((fs) => fs.promises.mkdir(dir, { recursive: true }));
    } catch {
      // best-effort mkdir
    }
    await shell.openPath(dir);
  });

  ipcMain.handle(IPC.settingsDiscoverAllHermesProfiles, async (): Promise<HermesProfile[]> => {
    return discoverAllHermesProfiles();
  });

  ipcMain.handle(IPC.settingsGetHermesProfiles, async (): Promise<HermesProfile[]> => {
    return getCachedHermesProfiles();
  });

  ipcMain.handle(
    IPC.settingsSetHermesProfile,
    async (_e, profile: HermesProfile): Promise<void> => {
      await setActiveHermesProfile(profile);
    },
  );

  ipcMain.handle(IPC.settingsDiscoverHermesModels, async (): Promise<string[]> => {
    const s = await readStore();
    const base = s.hermesEndpoint?.trim();
    if (!base) throw new Error('Hermes endpoint not configured');
    const key = await import('../storage/secrets').then((m) => m.getSecret('hermes_api_key'));
    if (!key) throw new Error('Hermes API key not saved');
    const url = base.replace(/\/+$/, '') + '/models';
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    return (data.data ?? []).map((m) => m.id ?? '').filter(Boolean);
  });

  ipcMain.handle(IPC.settingsOpen, () => {
    openSettingsWindow();
  });

  ipcMain.handle(IPC.settingsClose, () => {
    closeSettingsWindow();
  });

  ipcMain.handle(IPC.secretsSet, async (_e, name: string, value: string) => {
    await setSecret(name, value);
  });

  ipcMain.handle(IPC.secretsHas, async (_e, name: string) => {
    return hasSecret(name);
  });

  ipcMain.handle(IPC.secretsClear, async (_e, name: string) => {
    await clearSecret(name);
  });

  ipcMain.handle(IPC.secretsOpenLink, async (_e, url: string) => {
    try {
      await shell.openExternal(url);
    } catch (err) {
      logger.warn('openExternal failed', err);
    }
  });
}
