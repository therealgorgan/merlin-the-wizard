// Single source of truth for the user-facing "extensions" (a.k.a. feature
// flags) catalog. Both the main process (`src/main/extensions.ts`) and the
// renderer settings UI (`src/renderer/settings/main.tsx`) import from here.
//
// Two flag types:
//   - boolean: simple on/off toggle. Surfaced as a checkbox in Settings.
//   - select:  enum picker with a fixed option list (e.g. drag-start anim).
//              Surfaced as a dropdown.

export type ExtensionFlag =
  | {
      kind: 'boolean';
      key: string;
      group: ExtensionGroup;
      label: string;
      description: string;
      default: boolean;
      /** If this flag was previously stored under a legacy top-level store key
       *  (before 0.4.0), name it here so the migration in extensions.ts can
       *  seed the new flag from the old value. */
      legacyStoreKey?: string;
    }
  | {
      kind: 'select';
      key: string;
      group: ExtensionGroup;
      label: string;
      description: string;
      default: string;
      options: ReadonlyArray<{ value: string; label: string }>;
    };

export type ExtensionGroup =
  | 'Drag'
  | 'Brain'
  | 'Animation'
  | 'Voice'
  | 'Visual'
  | 'System'
  | 'BrainController';

// "none" is a common sentinel for "don't fire any animation".
const NONE = { value: 'none', label: 'None (do nothing)' } as const;

// Curated subset of clippyjs Merlin animations the user is likely to want as
// drag start/end animations. Avoid the long *ing variants (Thinking 7.4s,
// Reading 9.7s) — they'd overhang. Avoid Hide/Show — they affect visibility.
const DRAG_START_ANIM_OPTIONS = [
  { value: 'MoveUp', label: 'MoveUp — copter-hat (default)' },
  { value: 'MoveLeft', label: 'MoveLeft' },
  { value: 'MoveRight', label: 'MoveRight' },
  { value: 'MoveDown', label: 'MoveDown' },
  { value: 'Surprised', label: 'Surprised — startled' },
  { value: 'Alert', label: 'Alert' },
  { value: 'GestureUp', label: 'GestureUp — point' },
  { value: 'GetAttention', label: 'GetAttention — wave-up' },
  { value: 'Acknowledge', label: 'Acknowledge — nod' },
  { value: 'Wave', label: 'Wave' },
  NONE,
] as const;

const DRAG_END_ANIM_OPTIONS = [
  { value: 'auto-idle', label: 'Auto — random idle pose (default)' },
  { value: 'RestPose', label: 'RestPose — neutral stand' },
  { value: 'Blink', label: 'Blink' },
  { value: 'Acknowledge', label: 'Acknowledge — nod' },
  { value: 'Pleased', label: 'Pleased — smile' },
  { value: 'Wave', label: 'Wave' },
  { value: 'LookLeft', label: 'LookLeft' },
  { value: 'LookRight', label: 'LookRight' },
  NONE,
] as const;

export const EXTENSIONS_CATALOG: readonly ExtensionFlag[] = [
  // ── Drag visuals + animation ──────────────────────────────────────────────
  {
    kind: 'select',
    key: 'behavior.drag.start_animation',
    group: 'Drag',
    label: 'On drag start',
    description:
      "Which animation Merlin plays the moment you start dragging him. " +
      "Default 'MoveUp' shows his magic halo. Pick 'None' to skip.",
    default: 'MoveUp',
    options: DRAG_START_ANIM_OPTIONS,
  },
  {
    kind: 'select',
    key: 'behavior.drag.end_animation',
    group: 'Drag',
    label: 'On drag end',
    description:
      "Which animation Merlin plays after you release him. 'Auto' picks " +
      "a random calm idle gesture. 'None' leaves him still.",
    default: 'auto-idle',
    options: DRAG_END_ANIM_OPTIONS,
  },
  {
    kind: 'boolean',
    key: 'behavior.drag.sway',
    group: 'Drag',
    label: 'Pendulum sway during drag',
    description: 'Merlin tilts toward the direction of drag, settles back when still.',
    default: true,
  },
  {
    kind: 'boolean',
    key: 'behavior.drag.scale',
    group: 'Drag',
    label: 'Lift effect (slight scale-up) on grab',
    description: 'Subtle "picked up" zoom while dragging.',
    default: true,
  },
  {
    kind: 'boolean',
    key: 'behavior.drag.shadow',
    group: 'Drag',
    label: 'Drop shadow during drag',
    description: 'Stronger shadow under Merlin while he\'s being moved.',
    default: true,
  },

  // ── Brain / autonomy ──────────────────────────────────────────────────────
  {
    kind: 'boolean',
    key: 'behavior.brain.wander',
    group: 'Brain',
    label: 'Autonomous wander',
    description: 'Merlin drifts to a new spot occasionally when idle.',
    default: true,
  },
  {
    kind: 'boolean',
    key: 'behavior.brain.idle_thoughts',
    group: 'Brain',
    label: 'Idle thoughts',
    description: 'Random musings appear in the chat panel/bubble when you\'ve been idle a while.',
    default: true,
    legacyStoreKey: 'idleThoughtsEnabled',
  },
  {
    kind: 'boolean',
    key: 'behavior.brain.eye_tracking',
    group: 'Brain',
    label: 'Eye-tracking (glance toward cursor)',
    description: 'Merlin periodically looks toward your mouse cursor.',
    default: true,
  },
  {
    kind: 'boolean',
    key: 'behavior.brain.sleep_timer',
    group: 'Brain',
    label: 'Sleep timer (20-min idle → rest)',
    description: 'After 20 minutes with no interaction, Merlin enters a resting pose.',
    default: true,
  },
  {
    kind: 'boolean',
    key: 'behavior.brain.app_focus_reaction',
    group: 'Brain',
    label: 'React to app focus (perk-up)',
    description: 'Subtle fidget when the Merlin window gains focus.',
    default: true,
  },
  {
    kind: 'boolean',
    key: 'behavior.brain.app_blur_reaction',
    group: 'Brain',
    label: 'React to app blur (glance away)',
    description: 'Subtle look-away when you switch to a different app.',
    default: true,
  },

  // ── Animation cycles + reactions ──────────────────────────────────────────
  {
    kind: 'boolean',
    key: 'behavior.animation.speaking_cycle',
    group: 'Animation',
    label: 'Speaking gestures during voice',
    description: 'Merlin gestures every few seconds while speaking aloud.',
    default: true,
  },
  {
    kind: 'boolean',
    key: 'behavior.animation.thinking_cycle',
    group: 'Animation',
    label: 'Thinking gestures while LLM generates',
    description: 'Cycles through Think / Read / Write while waiting for the response.',
    default: true,
  },
  {
    kind: 'boolean',
    key: 'behavior.animation.energy_modulation',
    group: 'Animation',
    label: 'Energy + time-of-day modulation',
    description: 'Animation density / palette tilts based on Merlin\'s simulated energy + time of day.',
    default: true,
  },
  {
    kind: 'boolean',
    key: 'behavior.animation.mood_palettes',
    group: 'Animation',
    label: 'Mood-weighted animation picks',
    description: 'Cheerful, thoughtful, sleepy, etc. moods bias animation selection. Off = always cheerful.',
    default: true,
  },
  {
    kind: 'boolean',
    key: 'behavior.animation.content_reactions',
    group: 'Animation',
    label: 'Content reactions ("thanks" / "wow" / "?")',
    description: 'Quick gesture when your message contains certain words or punctuation.',
    default: true,
  },
  {
    kind: 'boolean',
    key: 'behavior.animation.tool_reactions',
    group: 'Animation',
    label: 'Tool reactions',
    description: 'Per-tool animations (Searching for web_search, Write for tasks, etc.) and success/failure follow-ups.',
    default: true,
  },
  {
    kind: 'boolean',
    key: 'behavior.animation.double_click_random',
    group: 'Animation',
    label: 'Random gesture on double-click',
    description: 'Pick from a pool of playful animations. Off = always "Pleased".',
    default: true,
  },
  {
    kind: 'boolean',
    key: 'behavior.animation.zoom_reaction',
    group: 'Animation',
    label: 'Surprised reaction on mouse-wheel zoom',
    description: 'Plays Surprised when you scroll-wheel over Merlin.',
    default: true,
  },

  // ── Voice / welcome ───────────────────────────────────────────────────────
  {
    kind: 'boolean',
    key: 'behavior.voice.welcome',
    group: 'Voice',
    label: 'Welcome greeting on startup',
    description: 'Merlin greets you when the app launches.',
    default: true,
    legacyStoreKey: 'showWelcomeOnStart',
  },
  {
    kind: 'boolean',
    key: 'behavior.voice.welcome_spoken',
    group: 'Voice',
    label: 'Speak the welcome aloud',
    description: 'Reads the startup greeting via TTS (requires voice engine ≠ Off).',
    default: true,
    legacyStoreKey: 'speakWelcome',
  },
  {
    kind: 'boolean',
    key: 'behavior.voice.auto_mute_sfx_during_tts',
    group: 'Voice',
    label: 'Mute animation SFX while speaking',
    description: 'Silences clippyjs animation sounds during TTS so they don\'t compete with the voice.',
    default: true,
  },

  // ── Visuals ───────────────────────────────────────────────────────────────
  {
    kind: 'boolean',
    key: 'behavior.visual.wiggle_on_nudge',
    group: 'Visual',
    label: 'Wiggle when emitting idle thoughts',
    description: 'Small left-right shimmy when Merlin pops an idle thought.',
    default: true,
  },
  {
    kind: 'boolean',
    key: 'behavior.visual.smooth_drag_paint',
    group: 'Visual',
    label: 'Smooth-drag (throttle window moves)',
    description: 'Coalesces window-move events to 30Hz so clippyjs frame animation can render during drag. Disable for one-to-one cursor tracking.',
    default: true,
  },

  // ── System ────────────────────────────────────────────────────────────────
  {
    kind: 'boolean',
    key: 'behavior.system.summon_hotkey',
    group: 'System',
    label: 'Global summon hotkey',
    description: 'Ctrl+Shift+M (or rebound) opens the ask bubble from anywhere.',
    default: true,
  },

  // ── Brain controller (Phase 2 hook) ───────────────────────────────────────
  {
    kind: 'boolean',
    key: 'behavior.brain_controller.allow_override_actions',
    group: 'BrainController',
    label: 'Allow brain controller to override behavior flags',
    description:
      'Advanced. When an LLM-driven brain controller returns an action (e.g. wander), allow it even if the corresponding behavior flag is off.',
    default: false,
  },
];

/** Index by key for O(1) lookups in main + renderer. */
export const EXTENSIONS_BY_KEY: Readonly<Record<string, ExtensionFlag>> =
  EXTENSIONS_CATALOG.reduce<Record<string, ExtensionFlag>>((acc, flag) => {
    acc[flag.key] = flag;
    return acc;
  }, {});

/** All keys, in catalog order. */
export const EXTENSION_KEYS: readonly string[] = EXTENSIONS_CATALOG.map((f) => f.key);

/** Default value (typed boolean or string depending on kind). */
export function defaultFor(key: string): boolean | string {
  const flag = EXTENSIONS_BY_KEY[key];
  return flag ? flag.default : true;
}
