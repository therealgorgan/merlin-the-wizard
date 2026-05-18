import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import {
  createSpriteWindow,
  getSpriteWindow,
  hideSprite,
  showSprite,
  setZoom,
  getZoom,
  setMuteSounds,
  getMuteSounds,
  setVoiceEngine,
  getVoiceEngine,
  setCharacter,
  getCharacterId,
  ZOOM_PRESETS,
} from './windows/spriteWindow';
import { cancelVoice } from './voice/tts';
import { getAllCharacters } from './customCharacters';
import { getAutoStart, setAutoStart } from './autostart';
import { createDebugWindow } from './windows/debugWindow';
import { openSettingsWindow } from './windows/settingsWindow';
import { openHistoryWindow } from './windows/historyWindow';
import { forgetConversation } from './interaction';
import { getMood, moodLabel } from './feelings';
import { buildAnimationSubmenu } from './animationMenu';
import { listTasks, completeTask, removeTask } from './tasks';
import { currentProviderLabel } from './llm/providerRegistry';
import {
  getCachedHermesProfiles,
  setActiveHermesProfile,
  discoverAllHermesProfiles,
} from './hermesDiscovery';
import { read as readStore } from './storage/store';

function zoomLabel(z: number): string {
  return `${z.toFixed(z % 1 === 0 ? 0 : 1)}x`;
}

export interface MerlinMenuActions {
  askMerlin: () => void;
  onZoomChange?: () => void | Promise<void>;
  onMuteChange?: () => void | Promise<void>;
  onVoiceChange?: () => void | Promise<void>;
  onTasksChange?: () => void | Promise<void>;
  onCharacterChange?: () => void | Promise<void>;
  onAutoStartChange?: () => void | Promise<void>;
  onHermesProfileChange?: () => void | Promise<void>;
  onDisplayModeChange?: () => void | Promise<void>;
  onAppearanceChange?: () => void | Promise<void>;
}

export async function buildMerlinMenu(actions: MerlinMenuActions): Promise<Menu> {
  const { hasSecret } = await import('./storage/secrets');
  const [
    currentZoom, muted, mood, voiceEngine, tasks, llmLabel, charId, autoStart, settings,
    elevenLabsConfigured,
  ] = await Promise.all([
    getZoom(),
    getMuteSounds(),
    getMood(),
    getVoiceEngine(),
    listTasks({ includeCompleted: false }),
    currentProviderLabel(),
    getCharacterId(),
    getAutoStart(),
    readStore(),
    hasSecret('elevenlabs_api_key'),
  ]);

  // Hermes profile quick-switcher — only shown when Hermes is the active
  // provider. Uses the cached list so the menu opens instantly; users refresh
  // via the "Discover all profiles" entry at the bottom.
  const hermesActive = settings.llmProvider === 'hermes';
  let hermesSubmenu: MenuItemConstructorOptions[] = [];
  if (hermesActive) {
    const cached = await getCachedHermesProfiles();
    if (cached.length === 0) {
      hermesSubmenu.push({
        label: '(no profiles cached — pick "Discover all" below)',
        enabled: false,
      });
    } else {
      for (const p of cached) {
        const isActive =
          settings.hermesEndpoint === p.url || settings.llmModel === p.name;
        hermesSubmenu.push({
          label: p.name,
          type: 'radio',
          checked: isActive,
          click: async () => {
            await setActiveHermesProfile(p);
            await actions.onHermesProfileChange?.();
          },
        });
      }
    }
    hermesSubmenu.push({ type: 'separator' });
    hermesSubmenu.push({
      label: 'Discover all profiles…',
      click: async () => {
        try {
          await discoverAllHermesProfiles();
          await actions.onHermesProfileChange?.();
        } catch (err) {
          // Surface failures via a temporary bubble would be nicer, but the
          // tray menu has no easy hook to do that — log and rely on the menu
          // refresh next time.
          // eslint-disable-next-line no-console
          console.warn('Hermes discovery failed:', err);
        }
      },
    });
  }

  const characterSubmenu: MenuItemConstructorOptions[] = getAllCharacters().map((c) => ({
    label: c.displayName,
    type: 'radio',
    checked: charId === c.id,
    click: async () => {
      await setCharacter(c.id);
      await actions.onCharacterChange?.();
    },
  }));

  const tasksSubmenu: MenuItemConstructorOptions[] =
    tasks.length === 0
      ? [{ label: '(no tasks — ask Merlin to add some)', enabled: false }]
      : tasks.map(
          (t): MenuItemConstructorOptions => ({
            label: t.title,
            submenu: [
              {
                label: 'Complete',
                click: async () => {
                  await completeTask(t.id);
                  await actions.onTasksChange?.();
                },
              },
              {
                label: 'Delete',
                click: async () => {
                  await removeTask(t.id);
                  await actions.onTasksChange?.();
                },
              },
            ],
          }),
        );

  const groqAvailable = Boolean(process.env.GROQ_API_KEY);
  const voiceSubmenu: MenuItemConstructorOptions[] = [
    {
      label: 'Off',
      type: 'radio',
      checked: voiceEngine === 'off',
      click: async () => {
        cancelVoice();
        await setVoiceEngine('off');
        await actions.onVoiceChange?.();
      },
    },
    {
      label: 'Windows SAPI (offline, no key)',
      type: 'radio',
      checked: voiceEngine === 'sapi',
      click: async () => {
        cancelVoice();
        await setVoiceEngine('sapi');
        await actions.onVoiceChange?.();
      },
    },
    {
      label: groqAvailable
        ? 'Groq Orpheus (cloud, uses Groq key)'
        : 'Groq Orpheus (no Groq key configured)',
      type: 'radio',
      checked: voiceEngine === 'groq',
      enabled: groqAvailable,
      click: async () => {
        cancelVoice();
        await setVoiceEngine('groq');
        await actions.onVoiceChange?.();
      },
    },
    {
      label: 'OpenRouter TTS (cloud, uses OpenRouter key)',
      type: 'radio',
      checked: voiceEngine === 'openrouter',
      click: async () => {
        cancelVoice();
        await setVoiceEngine('openrouter');
        await actions.onVoiceChange?.();
      },
    },
    {
      label: 'Microsoft Edge Neural (cloud, free, no key)',
      type: 'radio',
      checked: voiceEngine === 'edge',
      click: async () => {
        cancelVoice();
        await setVoiceEngine('edge');
        await actions.onVoiceChange?.();
      },
    },
    {
      label: elevenLabsConfigured
        ? 'ElevenLabs (cloud, separate key)'
        : 'ElevenLabs (no API key — set in Settings)',
      type: 'radio',
      checked: voiceEngine === 'elevenlabs',
      enabled: elevenLabsConfigured,
      click: async () => {
        cancelVoice();
        await setVoiceEngine('elevenlabs');
        await actions.onVoiceChange?.();
      },
    },
  ];

  const sizeSubmenu: MenuItemConstructorOptions[] = ZOOM_PRESETS.map((z) => ({
    label: zoomLabel(z),
    type: 'radio',
    checked: Math.abs(currentZoom - z) < 0.001,
    click: async () => {
      await setZoom(z);
      await actions.onZoomChange?.();
    },
  }));

  const aiStatus = `AI: ${llmLabel}`;
  const moodStatus = `Mood: ${moodLabel(mood)}`;
  const voiceLabel =
    voiceEngine === 'sapi'
      ? 'Voice: Windows (SAPI)'
      : voiceEngine === 'groq'
        ? 'Voice: Groq Orpheus'
        : voiceEngine === 'openrouter'
          ? 'Voice: OpenRouter TTS'
          : voiceEngine === 'edge'
            ? 'Voice: Edge Neural'
            : voiceEngine === 'elevenlabs'
              ? 'Voice: ElevenLabs'
              : 'Voice: Off';

  return Menu.buildFromTemplate([
    { label: aiStatus, enabled: false },
    ...(hermesActive
      ? ([{ label: 'Hermes profile', submenu: hermesSubmenu }] as MenuItemConstructorOptions[])
      : []),
    { label: moodStatus, enabled: false },
    { label: voiceLabel, enabled: false },
    { type: 'separator' },
    { label: 'Ask Merlin... (chat)', click: () => actions.askMerlin() },
    {
      label: `Tasks (${tasks.length})`,
      submenu: tasksSubmenu,
    },
    { label: 'Conversation History...', click: () => openHistoryWindow() },
    {
      label: 'Forget Conversation',
      click: async () => {
        await forgetConversation();
      },
    },
    {
      label: 'Stop Voice',
      click: () => cancelVoice(),
    },
    { type: 'separator' },
    {
      label: 'Show Merlin',
      click: async () => {
        if (!getSpriteWindow()) await createSpriteWindow();
        else showSprite();
      },
    },
    { label: 'Hide Merlin', click: () => hideSprite() },
    { label: 'Character', submenu: characterSubmenu },
    {
      label: 'Display mode',
      submenu: [
        {
          label: 'Classic — floating sprite + speech bubble',
          type: 'radio',
          checked: settings.displayMode === 'classic',
          click: async () => {
            const { write } = await import('./storage/store');
            await write({ displayMode: 'classic' });
            const sw = getSpriteWindow();
            sw?.show();
            const { hideChatPanel } = await import('./windows/chatPanelWindow');
            hideChatPanel();
            await actions.onDisplayModeChange?.();
          },
        },
        {
          label: 'Modern — floating sprite + docked chat panel',
          type: 'radio',
          checked: settings.displayMode === 'modern',
          click: async () => {
            const { write } = await import('./storage/store');
            await write({ displayMode: 'modern' });
            // Keep sprite visible alongside the panel — sprite is the
            // draggable character, panel is the chat surface.
            const sw = getSpriteWindow() ?? (await createSpriteWindow());
            sw.show();
            const { showChatPanel } = await import('./windows/chatPanelWindow');
            showChatPanel();
            await actions.onDisplayModeChange?.();
          },
        },
      ],
    },
    {
      label: 'Sprite appearance',
      submenu: [
        {
          label: 'Classic — original 90s pixel art',
          type: 'radio',
          checked: settings.appearance !== 'retouched',
          click: async () => {
            const { write } = await import('./storage/store');
            await write({ appearance: 'classic' });
            const sw = getSpriteWindow();
            sw?.webContents.send('sprite:setAppearance', 'classic');
            await actions.onAppearanceChange?.();
          },
        },
        {
          label: 'Retouched — smoothed for modern displays',
          type: 'radio',
          checked: settings.appearance === 'retouched',
          click: async () => {
            const { write } = await import('./storage/store');
            await write({ appearance: 'retouched' });
            const sw = getSpriteWindow();
            sw?.webContents.send('sprite:setAppearance', 'retouched');
            await actions.onAppearanceChange?.();
          },
        },
      ],
    },
    { label: 'Play Animation', submenu: buildAnimationSubmenu() },
    { label: 'Size', submenu: sizeSubmenu },
    {
      label: 'Mute Sound Effects',
      type: 'checkbox',
      checked: muted,
      click: async (item) => {
        await setMuteSounds(item.checked);
        await actions.onMuteChange?.();
      },
    },
    { label: 'Voice', submenu: voiceSubmenu },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: autoStart,
      click: async (item) => {
        await setAutoStart(item.checked);
        await actions.onAutoStartChange?.();
      },
    },
    { label: 'Settings...', click: () => openSettingsWindow() },
    { label: 'Debug Panel', click: () => createDebugWindow() },
    { type: 'separator' },
    { label: 'Quit Merlin', click: () => app.quit() },
  ]);
}
