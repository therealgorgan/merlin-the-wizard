import type { AnimationName } from './animations';
import type { Settings } from './types';

export const IPC = {
  // sprite control
  spritePlay: 'sprite:play',
  spriteStop: 'sprite:stop',
  spriteShow: 'sprite:show',
  spriteHide: 'sprite:hide',
  spriteSetPosition: 'sprite:setPosition',
  spriteSetZoom: 'sprite:setZoom',
  spriteZoomBy: 'sprite:zoomBy',
  spriteSetMuteSounds: 'sprite:setMuteSounds',
  spritePlayAudio: 'sprite:playAudio',
  spriteStopAudio: 'sprite:stopAudio',
  spriteSetCharacter: 'sprite:setCharacter',
  spriteSetAppearance: 'sprite:setAppearance',
  spriteGetInitial: 'sprite:getInitial',

  // bubble
  bubbleShow: 'bubble:show',
  bubbleHide: 'bubble:hide',
  bubbleSetText: 'bubble:setText',
  bubbleAppendText: 'bubble:appendText',
  bubbleSetTailSide: 'bubble:setTailSide',
  bubbleSetMode: 'bubble:setMode',
  bubbleSetSuggestions: 'bubble:setSuggestions',
  bubbleClear: 'bubble:clear',

  // chat panel (modern mode)
  panelShow: 'panel:show',
  panelHide: 'panel:hide',
  panelOpenForAsk: 'panel:openForAsk',
  panelSetStreaming: 'panel:setStreaming',
  panelAppendAssistantChunk: 'panel:appendAssistantChunk',
  panelFinalizeAssistant: 'panel:finalizeAssistant',
  panelAddUserTurn: 'panel:addUserTurn',
  panelSetSuggestions: 'panel:setSuggestions',
  panelSetTailSide: 'panel:setTailSide',
  panelAddIdleThought: 'panel:addIdleThought',
  panelDismissIdleThought: 'panel:dismissIdleThought',
  panelSubmit: 'panel:submit',
  panelStop: 'panel:stop',
  panelRegenerate: 'panel:regenerate',
  panelGetInitial: 'panel:getInitial',

  // sprite events to main
  spriteDoubleClicked: 'sprite:doubleClicked',
  spriteRightClicked: 'sprite:rightClicked',

  // bubble events to main
  bubbleSubmit: 'bubble:submit',
  bubbleDismiss: 'bubble:dismiss',

  // chat
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatStreamEvent: 'chat:streamEvent',
  chatAttachFile: 'chat:attachFile',
  chatPendingCount: 'chat:pendingCount',
  chatClearPending: 'chat:clearPending',
  chatTranscribeAudio: 'chat:transcribeAudio',
  chatHistory: 'chat:history',
  chatScreenshotReady: 'chat:screenshotReady',
  chatCaptureScreen: 'chat:captureScreen',
  chatPendingScreenshot: 'chat:pendingScreenshot',
  chatClearScreenshot: 'chat:clearScreenshot',

  // settings
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsGetProviderInfo: 'settings:getProviderInfo',
  settingsGetSapiVoices: 'settings:getSapiVoices',
  settingsOpen: 'settings:open',
  settingsClose: 'settings:close',
  settingsGetCharacters: 'settings:getCharacters',
  settingsReloadCharacters: 'settings:reloadCharacters',
  settingsOpenCharactersFolder: 'settings:openCharactersFolder',
  settingsDiscoverHermesModels: 'settings:discoverHermesModels',
  settingsDiscoverAllHermesProfiles: 'settings:discoverAllHermesProfiles',
  settingsGetHermesProfiles: 'settings:getHermesProfiles',
  settingsSetHermesProfile: 'settings:setHermesProfile',

  // secrets
  secretsSet: 'secrets:set',
  secretsHas: 'secrets:has',
  secretsClear: 'secrets:clear',
  secretsOpenLink: 'secrets:openLink',

  // tools
  toolRequestConfirm: 'tool:requestConfirm',

  // window control
  windowDrag: 'window:drag',
  windowDragEnd: 'window:dragEnd',
  windowClose: 'window:close',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

// ---- preload-exposed APIs (typed shape) ----

export interface SpriteApi {
  /** Subscribed by renderer to receive animation play commands from main. */
  onPlay: (cb: (name: AnimationName) => void) => () => void;
  /** Interrupt the current animation + clear the queue (e.g. on drag start). */
  onStop: (cb: () => void) => () => void;
  onShow: (cb: () => void) => () => void;
  onHide: (cb: () => void) => () => void;
  onSetZoom: (cb: (zoom: number) => void) => () => void;
  onSetMuteSounds: (cb: (muted: boolean) => void) => () => void;
  onPlayAudio: (cb: (dataUrl: string) => void) => () => void;
  onStopAudio: (cb: () => void) => () => void;
  onSetCharacter: (cb: (characterId: string) => void) => () => void;
  onSetAppearance: (cb: (appearance: 'classic' | 'retouched') => void) => () => void;
  /** Renderer pulls current state once it has wired all event handlers. */
  /** Avoids races with main pushing initial state before the renderer is ready. */
  getInitial: () => Promise<{
    zoom: number;
    muteSounds: boolean;
    character: string;
    appearance: 'classic' | 'retouched';
  }>;
  /** Tells main this animation has finished playing. */
  reportAnimationDone: (name: AnimationName) => void;
  /** Drag the window by delta (main moves the window). */
  startDrag: () => void;
}

export type BubbleMode = 'read' | 'ask';
export type TailSide = 'left' | 'right' | 'top' | 'bottom';
/** Offset along the chosen side as a 0-1 fraction. For 'left'/'right' it's */
/** vertical (0=top of bubble, 1=bottom). For 'top'/'bottom' it's horizontal */
/** (0=left of bubble, 1=right). Lets the tail actually point at Merlin when */
/** he isn't aligned with the bubble's midpoint. */
export interface TailPlacement {
  side: TailSide;
  offset: number;
}
export interface BubblePayload {
  text: string;
  mode: BubbleMode;
}

export interface BubbleApi {
  onSetText: (cb: (payload: BubblePayload) => void) => () => void;
  onAppendText: (cb: (text: string) => void) => () => void;
  onSetTailSide: (cb: (placement: TailPlacement) => void) => () => void;
  onSetMode: (cb: (mode: BubbleMode) => void) => () => void;
  onSetSuggestions: (cb: (suggestions: string[]) => void) => () => void;
  submit: (text: string) => void;
  dismiss: () => void;
  attachFile: (path: string) => Promise<{ ok: boolean; name?: string; error?: string }>;
  attachDroppedFile: (file: File) => Promise<{ ok: boolean; name?: string; error?: string }>;
  pendingCount: () => Promise<number>;
  clearPending: () => Promise<void>;
  transcribe: (audioBase64: string, mime: string) => Promise<string | null>;
  onScreenshotReady: (
    cb: (meta: { width: number; height: number; bytes: number }) => void,
  ) => () => void;
  captureScreen: () => Promise<{ ok: boolean; width?: number; height?: number }>;
  getPendingScreenshot: () => Promise<{ width: number; height: number; bytes: number } | null>;
  clearScreenshot: () => Promise<void>;
}

export interface ProviderInfoForUi {
  id: string;
  displayName: string;
  suggestedModels: string[];
  defaultModel: string;
  needsApiKey: boolean;
  secretName?: string;
  keyHelpUrl?: string;
}

export interface StoreSnapshot {
  llmProvider: string;
  llmModel: string;
  ollamaEndpoint: string;
  hermesEndpoint: string;
  voiceEngine: string;
  voiceName: string;
  character: string;
  userName: string | null;
  summonHotkey: string;
  autoStart: boolean;
  idleThoughtsEnabled: boolean;
  showWelcomeOnStart: boolean;
  speakWelcome: boolean;
  screenshotHotkey: string;
  screenshotHotkeyEnabled: boolean;
  displayMode: 'classic' | 'modern';
  appearance: 'classic' | 'retouched';
}

export interface PanelChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** True while this assistant turn is mid-stream — enables the Stop button. */
  streaming?: boolean;
}

/** A passive "thought" Merlin emits when the user has been idle for a while. */
/** Renders inline in the chat thread with a visible countdown — auto-removes */
/** itself when the timer expires (or earlier if the user dismisses it or */
/** sends a message that supersedes it). */
export interface PanelIdleThought {
  id: string;
  text: string;
  /** When the thought was emitted (epoch ms). */
  emittedAt: number;
  /** How long until it expires (ms from emittedAt). */
  ttlMs: number;
}

export interface PanelApi {
  /** Streamed assistant text in chunks. */
  onAppendAssistantChunk: (cb: (text: string) => void) => () => void;
  /** Begin a new assistant turn (renderer adds a placeholder bubble). */
  onSetStreaming: (cb: (streaming: boolean) => void) => () => void;
  /** A complete user or assistant turn from main (e.g. on history load). */
  onAddUserTurn: (cb: (text: string) => void) => () => void;
  /** Mark the latest assistant turn done; pass final tag-stripped text. */
  onFinalizeAssistant: (cb: (text: string) => void) => () => void;
  onSetSuggestions: (cb: (sug: string[]) => void) => () => void;
  /** Tail-side updates (mirrors bubble) — panel renders a tail that points */
  /** at the floating sprite window so the chat reads as "attached" to Merlin. */
  onSetTailSide: (cb: (placement: TailPlacement) => void) => () => void;
  /** Push a new idle thought into the thread. The panel renders it with a */
  /** visible countdown and auto-removes when the TTL expires. */
  onAddIdleThought: (cb: (thought: PanelIdleThought) => void) => () => void;
  /** Tell main the user dismissed (or the timer expired) an idle thought, */
  /** so brain doesn't fire it again immediately. */
  dismissIdleThought: (id: string) => void;
  /** Open the panel + focus the input. */
  onOpenForAsk: (cb: () => void) => () => void;
  /** Submit user text from the panel back to main. */
  submit: (text: string) => void;
  stop: () => void;
  regenerate: () => void;
  /** Fetch initial state (character id, conversation history). */
  getInitial: () => Promise<{
    character: string;
    history: PanelChatTurn[];
  }>;
  /** File-attachment APIs (same shape as bubble). */
  attachDroppedFile: (file: File) => Promise<{ ok: boolean; name?: string; error?: string }>;
  transcribe: (audioBase64: string, mime: string) => Promise<string | null>;
  captureScreen: () => Promise<{ ok: boolean; width?: number; height?: number }>;
  getPendingScreenshot: () => Promise<{ width: number; height: number; bytes: number } | null>;
  clearScreenshot: () => Promise<void>;
  /** Sprite control IPC (matches SpriteApi). */
  onPlay: (cb: (name: import('./animations').AnimationName) => void) => () => void;
  onStop: (cb: () => void) => () => void;
  onPlayAudio: (cb: (dataUrl: string) => void) => () => void;
  onStopAudio: (cb: () => void) => () => void;
  onSetCharacter: (cb: (characterId: string) => void) => () => void;
}

export interface CharacterForUi {
  id: string;
  displayName: string;
  description: string;
  custom: boolean;
  baseCharacter?: string;
}

export interface SapiVoiceForUi {
  name: string;
  gender: string;
  age: string;
  culture: string;
}

export interface SettingsApi {
  get: () => Promise<StoreSnapshot>;
  set: (patch: Partial<StoreSnapshot>) => Promise<StoreSnapshot>;
  getProviders: () => Promise<ProviderInfoForUi[]>;
  getSapiVoices: () => Promise<SapiVoiceForUi[]>;
  setSecret: (name: string, key: string) => Promise<void>;
  hasSecret: (name: string) => Promise<boolean>;
  clearSecret: (name: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  close: () => void;
  getCharacters: () => Promise<CharacterForUi[]>;
  reloadCharacters: () => Promise<CharacterForUi[]>;
  openCharactersFolder: () => Promise<void>;
  discoverHermesModels: () => Promise<string[]>;
  discoverAllHermesProfiles: () => Promise<HermesProfileForUi[]>;
  getHermesProfiles: () => Promise<HermesProfileForUi[]>;
  setHermesProfile: (profile: HermesProfileForUi) => Promise<void>;
}

export interface HermesProfileForUi {
  name: string;
  url: string;
}

export interface DebugApi {
  play: (name: AnimationName) => void;
  show: () => void;
  hide: () => void;
}

declare global {
  interface Window {
    spriteApi?: SpriteApi;
    bubbleApi?: BubbleApi;
    settingsApi?: SettingsApi;
    debugApi?: DebugApi;
    panelApi?: PanelApi;
  }
}
