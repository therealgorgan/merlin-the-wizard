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
  /** Renderer → main: reports whether the audio queue + currently-playing
   *  audio are still active. Lets main keep the 'speaking' state (and its
   *  gesture cycle) alive until the user actually stops hearing Merlin. */
  spriteAudioStateChanged: 'sprite:audioStateChanged',
  spriteSetCharacter: 'sprite:setCharacter',
  spriteSetAppearance: 'sprite:setAppearance',
  spriteGetInitial: 'sprite:getInitial',
  /** Main → sprite renderer: push current extension flag values so renderer */
  /** can apply CSS-side gates (e.g. data-flag-drag-sway). Fired on settingsSet. */
  spriteSetExtensions: 'sprite:setExtensions',

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
  /** Main → panel: voice playback active/idle. Drives the Stop button so the */
  /** user can interrupt TTS even after the LLM stream has completed. */
  panelSetAudioActive: 'panel:setAudioActive',
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

  // setup wizard (v0.5.1)
  setupWizardOpen: 'setupWizard:open',
  setupWizardClose: 'setupWizard:close',
  setupWizardComplete: 'setupWizard:complete',

  // brain (v0.5.0)
  brainForceTick: 'brain:forceTick',

  // brain wizard (v0.5.0)
  brainWizardOpen: 'brainWizard:open',
  brainWizardClose: 'brainWizard:close',
  brainWizardDetectHardware: 'brainWizard:detectHardware',
  brainWizardScanForOllama: 'brainWizard:scanForOllama',
  brainWizardProbeOllama: 'brainWizard:probeOllama',
  brainWizardListOllamaModels: 'brainWizard:listOllamaModels',
  brainWizardPullOllamaModel: 'brainWizard:pullOllamaModel',
  brainWizardPullProgress: 'brainWizard:pullProgress',
  brainWizardCancelPull: 'brainWizard:cancelPull',
  brainWizardTestOllamaModel: 'brainWizard:testOllamaModel',
  brainWizardProbeHermes: 'brainWizard:probeHermes',
  brainWizardApply: 'brainWizard:apply',
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
    /** Snapshot of all extension flags so renderer can wire CSS gates up-front. */
    extensions: Record<string, boolean | string>;
  }>;
  /** Subscribe to live updates of extension flags from main. */
  onSetExtensions: (cb: (flags: Record<string, boolean | string>) => void) => () => void;
  /** Tells main this animation has finished playing. */
  reportAnimationDone: (name: AnimationName) => void;
  /** Drag the window by delta (main moves the window). */
  startDrag: () => void;
  /** Renderer notifies main when its TTS audio queue transitions between
   *  playing-something and fully-drained. Main uses this to keep the
   *  'speaking' state alive until the audio actually finishes. */
  reportAudioState: (active: boolean) => void;
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
  /** Mute clippyjs sound effects (the animation SFX baked into the original
   *  Microsoft Agent .acs files). Also controllable from the tray. */
  muteSounds: boolean;
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
  /** Per-behavior feature flags (extensions). Boolean or string by flag kind. */
  extensions: Record<string, boolean | string>;
  /** Active brain controller id. */
  brainController: string;
  /** Per-controller config map. */
  brainControllerConfig: Record<string, Record<string, unknown>>;
  /** True once the user has finished (or dismissed) the first-time Setup
   *  Wizard. main/index.ts uses this to decide whether to auto-pop the
   *  wizard 2 s after the sprite finishes its Greet on app start. */
  firstRunComplete: boolean;
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
  /** Set true once the user has engaged (typed a reply while it was visible). */
  /** Permanent thoughts skip the countdown chip and never auto-expire — they */
  /** become a part of the chat record alongside the user's turn. */
  permanent?: boolean;
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
  /** Voice playback active/idle. Used to keep the Stop button visible while */
  /** TTS is still playing, so the user can interrupt mid-sentence. */
  onSetAudioActive: (cb: (active: boolean) => void) => () => void;
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
  /** Opens the dedicated Brain Setup Wizard window (v0.5.0). */
  openBrainWizard: () => Promise<void>;
  /** Force the active brain controller to make one decision right now,
   *  bypassing the idle-floor + intent gates. Returns a one-line summary
   *  of what it chose. */
  forceBrainTick: () => Promise<string>;
  /** Lists models currently installed in the user's Ollama instance.
   *  Used by Settings → Brain model picker to badge "installed" entries. */
  listOllamaModels: () => Promise<Array<{ name: string; sizeBytes: number }>>;
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

// ── Brain Setup Wizard (v0.5.0) ───────────────────────────────────────────

export interface HardwareInfo {
  totalRamGb: number;
  freeRamGb: number;
  cpuModel: string;
  cpuCores: number;
  /** Best-effort GPU detection. Empty array if detection failed or no GPU. */
  gpus: Array<{ name: string; vramMb: number | null }>;
  platform: NodeJS.Platform;
}

export interface OllamaProbeResult {
  reachable: boolean;
  version?: string;
  installedModels: Array<{ name: string; sizeBytes: number; modifiedAt: string }>;
  error?: string;
}

export interface OllamaScanAttempt {
  url: string;
  source: 'stored' | 'env' | 'localhost' | 'loopback' | 'all-interfaces' | 'process' | 'alt-port';
  ok: boolean;
  error?: string;
}

export interface OllamaScanResult {
  /** Best endpoint that responded, or null if none did. Includes the model list. */
  detected: (OllamaProbeResult & { url: string }) | null;
  /** Every probe attempt we made, in order, with success/failure. Surfaced
   *  in the UI so the user can see what we tried. */
  attempted: OllamaScanAttempt[];
  /** If we found a running ollama.exe via PowerShell, this is what's listening. */
  processInfo?: { pid: number; port: number; localAddress: string };
  /** Value of OLLAMA_HOST env var if set. */
  ollamaHostEnv?: string;
}

export interface OllamaPullProgress {
  /** Stable id correlating progress events to a single pull request. */
  pullId: string;
  status: string; // e.g. "pulling 8de95da25cb6", "downloading", "success", "error"
  digest?: string;
  total?: number; // bytes
  completed?: number; // bytes
  /** Set on terminal events. 'done' = success, 'error' = failed/cancelled. */
  done?: 'done' | 'error';
  error?: string;
}

export interface OllamaTestResult {
  ok: boolean;
  /** Whatever the model said when asked a simple test prompt. */
  reply?: string;
  latencyMs?: number;
  error?: string;
}

export interface HermesProbeResult {
  reachable: boolean;
  /** Models advertised by /v1/models. */
  models: string[];
  /** Profiles discovered across known Hermes ports (if any). */
  profiles: Array<{ name: string; url: string }>;
  error?: string;
}

export interface BrainApplyConfig {
  controllerId: 'default' | 'local-llm' | 'hermes';
  /** Per-controller config that gets merged into brainControllerConfig[id]. */
  config?: Record<string, unknown>;
  /** Opt-in. When true AND controllerId is 'local-llm', also configure the
   *  conversational chat LLM to use the same Ollama endpoint + model. Lets
   *  one wizard run cover both surfaces if the user wants. Off by default
   *  so chat config never changes by surprise. */
  mirrorToChat?: boolean;
}

export interface BrainWizardApi {
  detectHardware: () => Promise<HardwareInfo>;
  /** Scans likely Ollama endpoints in parallel + inspects running processes.
   *  Returns the first responder + the full attempt log for transparency. */
  scanForOllama: () => Promise<OllamaScanResult>;
  probeOllama: (endpoint?: string) => Promise<OllamaProbeResult>;
  listOllamaModels: (endpoint?: string) => Promise<OllamaProbeResult['installedModels']>;
  /** Starts a pull. Returns the pullId; subscribe via onPullProgress to track. */
  pullOllamaModel: (model: string, endpoint?: string) => Promise<{ pullId: string }>;
  cancelPull: (pullId: string) => Promise<void>;
  onPullProgress: (cb: (ev: OllamaPullProgress) => void) => () => void;
  testOllamaModel: (model: string, endpoint?: string) => Promise<OllamaTestResult>;
  probeHermes: (endpoint: string, apiKey: string) => Promise<HermesProbeResult>;
  /** Persists the chosen brain config + hot-swaps the active controller. */
  apply: (cfg: BrainApplyConfig) => Promise<void>;
  /** Opens an external link in the default browser (for Ollama download). */
  openExternal: (url: string) => Promise<void>;
  /** Closes the wizard window. */
  close: () => void;
  /** Reads the current store snapshot (so wizard can pre-fill values). */
  getSnapshot: () => Promise<StoreSnapshot>;
  setSecret: (name: string, value: string) => Promise<void>;
  hasSecret: (name: string) => Promise<boolean>;
}

// ── Setup Wizard (v0.5.1) ─────────────────────────────────────────────────

export interface SetupWizardApi {
  getSnapshot: () => Promise<StoreSnapshot>;
  set: (patch: Partial<StoreSnapshot>) => Promise<StoreSnapshot>;
  getProviders: () => Promise<ProviderInfoForUi[]>;
  getCharacters: () => Promise<CharacterForUi[]>;
  setSecret: (name: string, value: string) => Promise<void>;
  hasSecret: (name: string) => Promise<boolean>;
  openExternal: (url: string) => Promise<void>;
  /** Mark the first-run wizard finished so it doesn't auto-pop again. */
  complete: () => Promise<void>;
  /** Close without marking complete (the wizard close also calls complete
   *  to avoid nagging, but giving us an explicit close lets us keep the
   *  two actions separable). */
  close: () => void;
  /** Open the Brain Setup Wizard (offered as an optional final step). */
  openBrainWizard: () => Promise<void>;
}

declare global {
  interface Window {
    spriteApi?: SpriteApi;
    bubbleApi?: BubbleApi;
    settingsApi?: SettingsApi;
    debugApi?: DebugApi;
    panelApi?: PanelApi;
    brainWizardApi?: BrainWizardApi;
    setupWizardApi?: SetupWizardApi;
  }
}
