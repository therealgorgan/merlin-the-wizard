import { app, Tray, nativeImage } from 'electron';
import { join } from 'node:path';
import { loadProjectEnv } from './loadEnv';

// Load .env (dev secrets like GROQ_API_KEY). Runs synchronously at module
// init so process.env is populated before any other module imports it.
const envResult = loadProjectEnv(__dirname);

import {
  createSpriteWindow,
  getSpriteWindow,
  setOnZoomChanged,
} from './windows/spriteWindow';
import { createDebugWindow } from './windows/debugWindow';
import { registerIpcHandlers } from './ipc/registerHandlers';
import { buildMerlinMenu } from './contextMenu';
import { openAskBubble } from './interaction';
import { playWelcome } from './welcome';
import { attachSpriteMoveSync } from './moveSync';
import { setOnMoodChange } from './feelings';
import { setOnTasksChange } from './tasks';
import { startBrain } from './brain';
import { registerScreenshotHotkey, registerSummonHotkey, unregisterAllHotkeys } from './hotkey';
import { syncAutoStartOnBoot } from './autostart';
import { loadCustomCharacters } from './customCharacters';
import { discoverAllHermesProfiles, getCachedHermesProfiles } from './hermesDiscovery';
import { hideChatPanel, showChatPanel } from './windows/chatPanelWindow';
import {
  startProactiveBehaviors,
  reactToAppBlur,
  reactToAppFocus,
  setHidden,
  setVisible,
} from './animationController';
import { logger } from './logger';

let tray: Tray | null = null;

async function rebuildTrayMenu(): Promise<void> {
  if (!tray) return;
  tray.setContextMenu(
    await buildMerlinMenu({
      askMerlin: () => openAskBubble(),
      onZoomChange: () => rebuildTrayMenu(),
      onMuteChange: () => rebuildTrayMenu(),
      onVoiceChange: () => rebuildTrayMenu(),
      onTasksChange: () => rebuildTrayMenu(),
      onCharacterChange: () => rebuildTrayMenu(),
      onAutoStartChange: () => rebuildTrayMenu(),
      onHermesProfileChange: () => rebuildTrayMenu(),
      onDisplayModeChange: () => rebuildTrayMenu(),
      onAppearanceChange: () => rebuildTrayMenu(),
    }),
  );
}

function buildTray(): void {
  const icoPath = join(__dirname, '../../resources/icon.ico');
  const pngPath = join(__dirname, '../../resources/icon.png');

  let image = nativeImage.createFromPath(icoPath);
  if (image.isEmpty()) image = nativeImage.createFromPath(pngPath);
  if (image.isEmpty()) {
    logger.warn('Tray icon not found at', icoPath, 'or', pngPath);
    image = nativeImage.createEmpty();
  }

  tray = new Tray(image);
  tray.setToolTip('Merlin the Wizard');
  void rebuildTrayMenu();

  tray.on('click', async () => {
    const w = getSpriteWindow();
    if (!w) await createSpriteWindow();
    else if (w.isVisible()) await setHidden({ force: true });
    else await setVisible();
  });
}

app.whenReady().then(async () => {
  logger.info('Merlin starting');
  logger.info('.env load result:', envResult);
  logger.info(
    'AI:',
    process.env.GROQ_API_KEY
      ? `Groq configured (key found, length=${process.env.GROQ_API_KEY.length}, model llama-3.3-70b-versatile)`
      : 'NOT configured — set GROQ_API_KEY in .env to enable real chat',
  );
  const { read: readStore } = await import('./storage/store');
  const settings = await readStore();
  logger.info('Voice engine:', settings.voiceEngine, '(voice:', settings.voiceName, ')');
  // Load user-defined character personas from disk before wiring tray/menu.
  await loadCustomCharacters();
  registerIpcHandlers();
  const sprite = await createSpriteWindow();
  attachSpriteMoveSync(sprite);
  buildTray();
  // Keep the tray Size radio buttons in sync with wheel-driven zoom changes.
  setOnZoomChanged(() => void rebuildTrayMenu());
  // Keep the tray "Mood: ..." label fresh when the LLM emits [feel:...] tags.
  setOnMoodChange(() => void rebuildTrayMenu());
  // Refresh tray Tasks count/list when tools add/complete/remove.
  setOnTasksChange(() => void rebuildTrayMenu());
  // Warm the extensions-flag cache so isEnabled() works synchronously
  // everywhere from here on. Done BEFORE startBrain so the controller's
  // first tick sees fresh flags.
  const { warmExtensionsCache } = await import('./extensions');
  await warmExtensionsCache();
  // Start the active brain controller (default = timer-based; future
  // 0.5.0 versions register local-llm + hermes controllers in the registry).
  await startBrain();
  // Global summon hotkey (Ctrl+Shift+M by default).
  await registerSummonHotkey();
  // Global screenshot hotkey (Ctrl+Shift+S by default).
  await registerScreenshotHotkey();
  // Reconcile autostart flag with the OS.
  await syncAutoStartOnBoot();

  // Wire the GitHub-Releases updater. No-op in dev (only fires when packaged).
  const { startAutoUpdater } = await import('./updater');
  startAutoUpdater();

  // If Hermes is the active provider, kick off a background profile discovery
  // so the tray "Hermes profile" submenu is hot from the first right-click.
  // Skip the scan when we already have a cached list — users hit "Discover
  // all" in Settings to refresh.
  if (settings.llmProvider === 'hermes' && settings.hermesEndpoint?.trim()) {
    const cached = await getCachedHermesProfiles();
    if (cached.length === 0) {
      void discoverAllHermesProfiles()
        .then((found) => {
          logger.info('Auto-discovered', found.length, 'Hermes profile(s) at boot');
          void rebuildTrayMenu();
        })
        .catch((err) => {
          logger.warn('Auto-discovery failed (non-fatal):', err?.message ?? err);
        });
    }
  }

  sprite.webContents.once('did-finish-load', () => {
    setTimeout(() => void playWelcome(), 1600);
    // Boot eye-tracking + sleep timer once the sprite is up. (These reach
    // the active surface via getActiveSpriteHost so they work in modern too.)
    startProactiveBehaviors();

    // First-time Setup Wizard: auto-pop ~2s after the sprite plays Greet so
    // the user gets the "oh, there's Merlin!" moment before any config UI.
    // Suppressed once the user has finished (or dismissed) the wizard via
    // the firstRunComplete store flag.
    if (!settings.firstRunComplete) {
      logger.info('first run detected — auto-launching Setup Wizard in 3.5s');
      setTimeout(() => {
        void (async (): Promise<void> => {
          const { openSetupWizardWindow } = await import('./windows/setupWizardWindow');
          openSetupWizardWindow();
        })();
      }, 3_500);
    }
  });

  // App-level focus changes: Merlin glances away when the user switches to
  // another app, perks up when they come back. Both are probability-gated
  // and energy-weighted inside the controller so it doesn't feel busy.
  app.on('browser-window-blur', () => reactToAppBlur());
  app.on('browser-window-focus', () => void reactToAppFocus());

  // Modern mode: keep the floating sprite visible AND show the chat panel.
  // Sprite stays a free-floating window the user can drag anywhere; panel is
  // a docked chat thread alongside it. Classic mode: just the sprite, panel
  // stays uncreated until needed.
  if (settings.displayMode === 'modern') {
    logger.info('displayMode=modern — sprite + chat panel both visible');
    showChatPanel();
  } else {
    hideChatPanel();
  }
});

app.on('window-all-closed', () => {
  // Tray app: don't quit on window close. User must use tray > Quit.
});

app.on('before-quit', () => {
  logger.info('Merlin quitting');
  unregisterAllHotkeys();
});

app.on('will-quit', () => {
  unregisterAllHotkeys();
});
