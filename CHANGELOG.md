# Changelog

All notable changes to **Merlin the Wizard** are tracked here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project loosely follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

Nothing yet.

---

## [0.6.3] — 2026-05-29

Hotfix for the tray **"Check for Updates…"** button.

### Fixed

- **Tray "Check for Updates…" threw `Cannot read properties of undefined
  (reading 'checkForUpdates')`.** The handler did
  `const { autoUpdater } = await import('electron-updater')`; in the bundled
  output that compiles to a native dynamic `import()` of a CommonJS module,
  whose namespace exposes `autoUpdater` only as a lazy getter the module
  lexer can't see — so the destructured binding was `undefined`. The
  background auto-updater was never affected (it uses a static `import`,
  which compiles to a direct `require('electron-updater').autoUpdater`). The
  manual check now routes through a new `checkForUpdatesNow()` helper in
  `updater.ts` that reuses that working reference and reports
  update-available / up-to-date / dev-disabled explicitly.

---

## [0.6.2] — 2026-05-28

Critical packaging hotfix. **The character sprite was missing from every
published installer** — Merlin's body never rendered for anyone running a
release build (the chat surface still worked, masking the failure during
the author's dev-only testing).

### Fixed

- **Sprite packs absent from published builds.** The clippyjs agent assets
  (`src/renderer/public/agents/*`) are gitignored and fetched at build time
  by `npm run assets` (`scripts/prepare-merlin-assets.mjs`). Nothing in the
  `dist` script or the release CI workflow ever ran it, so CI checkouts
  packaged an empty `agents/` folder. At runtime clippyjs requested
  `../agents/Merlin/map.png`, got a 404, hit its `failCb`, and never created
  the `.clippy` DOM node — an invisible character. Confirmed by extracting
  the published v0.6.1 `app.asar` (0 `agents` entries vs 51 in a local
  build). Fix: `npm run assets` now runs as the first step of both `dist`
  scripts and as a dedicated step in the release workflow, so the sprite
  packs are present before electron-vite copies `public/` into the bundle.

---

## [0.5.1] — 2026-05-19

Polish + onboarding release. Major UI overhaul of Settings (left-sidebar
tabs) and tray menu (grouping submenus); brand-new **First-Time Setup
Wizard** that walks new users through name, character, chat LLM, voice,
and chat style on Day 1; the Brain Wizard now offers a one-click "use the
same model for chat too" checkbox; Hermes brain controller robustified
against the quirky structured-output behavior of OpenAI-compatible proxies.

### Added

- **🧙 First-Time Setup Wizard** (new window). 7 steps:
  1. Welcome
  2. Your name (what Merlin calls you)
  3. Character (avatar picker, lists installed characters)
  4. Chat LLM (provider picker + key entry — Groq recommended w/ free-key link)
  5. Voice engine (Edge Neural recommended; SAPI/Groq/Off also)
  6. Chat style (Classic bubble vs Modern panel)
  7. Done (summary + optional jump straight into the Brain Setup Wizard)

  Auto-launches 3.5 s after Merlin's Greet on first app start so the
  user gets the "oh, there's Merlin!" moment first. Suppressed via a
  new `firstRunComplete: boolean` store flag set on Finish / Skip /
  even on plain window-close (no nagging). Re-openable any time from
  the tray's Developer submenu.

- **Wizard "Also use this model for chat"** opt-in checkbox at the
  Brain Setup Wizard's Apply step. When checked (and controller is
  `local-llm`), the wizard also sets `llmProvider: 'ollama'`,
  `llmModel`, and `ollamaEndpoint` so a single wizard run configures
  both the autonomous brain AND the chat surface. Warning shown if
  the picked model is below 3 B ("too small for chat").

- **Shared brain-models catalog** at `src/shared/brain-models-catalog.ts`
  — single source of truth for 13 curated models (Qwen 2.5 0.5B/1.5B/7B,
  Qwen 2.5 Coder 3B/7B, Llama 3.2 1B/3B, Llama 3.1 8B, Llama 3.3 70B,
  Phi-3 Mini, Mistral 7B, Gemma 2 2B/9B) with size, min-RAM, and
  cold/warm response-time estimates. Imported by the Brain Wizard,
  Settings → Brain, Settings → Chat → Ollama, and the tray Brain
  submenu so labels and time estimates can't drift apart.

- **Settings → Chat → Ollama** now uses the same `BrainModelPicker`
  the Brain section uses — installed-badges, response-time estimates,
  custom-tag fallback.

- **About tab** in Settings: autostart, idle-thoughts legacy toggle,
  app version description, and quick links to GitHub repo, Issues
  tracker, and CHANGELOG.

- **New IPC channels**: `setupWizard:open`, `setupWizard:close`,
  `setupWizard:complete`.

- **New files**: `src/main/windows/setupWizardWindow.ts`,
  `src/preload/setupWizard.ts`, `src/renderer/setup-wizard/`
  (index.html / main.tsx / style.css).

### Changed

- **Settings UI: complete restructure into left-sidebar tabs.** 9 tabs:
  💬 Chat / 🧠 Brain / 🧙 Character / 🔊 Voice / 🎨 Appearance /
  ⚙️ Behaviors / ⌨️ Hotkeys / 🛠️ Tools / ℹ️ About. Each tab has its
  own scroll area. URL-hash deep-linking still works (tray "Extensions..."
  → `#extensions` → Behaviors tab). Misplaced fields were redistributed:
  - "Your name" → Character tab
  - Welcome / speak-welcome → Voice tab
  - Chat Style / Mute SFX / Sprite appearance → Appearance tab
  - Autostart / legacy idle-thoughts → About tab

- **Tray menu: complete reorganization.** Top-level went from ~28 items
  to ~12. Three disabled "AI / Mood / Voice" status rows collapsed into
  one combined "Status" row. Less-frequent items pushed into two new
  submenus:
  - **Customize**: Character, Chat Style, Sprite appearance, Voice engine,
    Start with Windows
  - **Developer**: Conversation History, Forget Conversation, Play
    Animation, Extensions deep-link, Re-run First-Time Setup, Debug Panel

- **Hermes brain controller**: switched from `generateObject` (which
  failed against Hermes's OpenAI-compatible proxy with "No object
  generated: the tool was not called" → then "could not parse the
  response") to `generateText` + manual JSON parse with:
  - Markdown code-fence stripping (```json ... ``` blocks)
  - Response normalization: `"type"` → `"action"` discriminator,
    `idleThought`/`idle-thought` → `idle_thought`
  - Zod `safeParse` with detailed failure messages
  - Concrete JSON examples in the system prompt
  - `forceTick` now returns the actual failure reason ("schema mismatch
    (action: ...)") instead of an opaque SDK error.

- **Brain Setup Wizard model cards** now show `⚡ Warm response: <s>`
  and `Cold load: <s>` lines per model.

- **Settings "Display mode" label renamed to "Chat Style"** to match
  the tray menu.

- **Settings window default size**: 720 × 760 (was 560 × 720); now
  resizable with `minWidth: 520` / `minHeight: 480`.

- **Extensions section layout**: now a CSS Grid (`repeat(auto-fill,
  minmax(220px, 1fr))`) packing 28 boolean flags 2-per-row at typical
  width. Select-type flags (drag-start / drag-end) span both columns.

- **"Chat LLM" vs "Brain LLM" verbiage**: Settings now labels the chat
  provider as "Chat (Conversational LLM)" and the brain as "Brain
  (Autonomous LLM)" with cross-referenced subtitles emphasizing they
  are independent.

### Fixed

- **Critical brain crash (carry-over from 0.5.0 alpha)**: lazy
  `require()` in `src/main/brainControllers/context.ts` didn't survive
  electron-vite bundling — relative paths only exist in source, not in
  the bundled `out/main/index.js`. Every brain tick was crashing with
  `Cannot find module '../animationController'`. Converted to static
  imports (there is no actual circular dep).

- **Wizard test timeout**: bumped from 45 s → 120 s. Cold-loading an
  8 B model on CPU-only systems can take 60-90 s for the first
  response. The test now also passes `keep_alive: '15m'` so the
  model stays resident for the brain's actual first tick.

- **Brain `keep_alive`**: local-llm `generateObject` calls now pass
  `providerOptions: { ollama: { keepAlive: '15m' } }` so models don't
  get unloaded between ticks at our 5-min cadence.

- **Checkbox sizing regression**: the earlier 200 px `min-width` I
  added to `.row input` for text inputs was also applying to
  checkboxes, reserving a 200 px-wide slot for each one and pushing
  labels far to the right. Scoped to
  `:not([type='checkbox']):not([type='radio'])`.

- **Settings horizontal scrollbar** killed via defensive
  `overflow-x: hidden` + `min-width: 0` rules.

- **Flex wrap fix**: `.row` containers now have `flex-wrap: wrap` so
  descriptions with `flex: 1 0 100%` actually wrap onto a new line
  instead of fighting the label for space.

---

## [0.5.0] — 2026-05-19

The brain itself gets a brain. Pluggable autonomous loops land — pick the
**default timer**, a **local Ollama model**, or a **Hermes Agent profile** to
drive what Merlin does between chats. A new dedicated **Brain Setup Wizard**
walks first-time users through installing Ollama, picking a model sized to
their hardware, pulling it, and verifying it works end-to-end.

### Added

- **🧙 Brain Setup Wizard** (new window). Multi-step React flow:
    1. Pick controller (default / local-llm / hermes).
    2. (local-llm) **Auto-scan for Ollama** — probes the user's saved
       endpoint, `OLLAMA_HOST` env var, common defaults
       (`localhost:11434`, `127.0.0.1:11434`, `0.0.0.0:11434`,
       alt-port `11435`), and inspects running `ollama.exe` via
       PowerShell (`Get-NetTCPConnection -OwningProcess`) to find the
       actual listening port. First responder wins. Falls back to
       manual endpoint entry with the full probe-attempt log surfaced
       in a collapsed details block.
    3. Detect hardware (RAM, CPU, GPU via PowerShell `Win32_VideoController`)
       and recommend a model tier. Curated list: Llama 3.2 1B/3B,
       Phi-3 Mini, Llama 3.1 8B, Mistral 7B, Qwen 2.5 7B — with
       size + min-RAM badges and "already installed" highlighting.
    4. Stream the Ollama pull with live progress (NDJSON parsed; bytes
       completed / total + pct). Cancellable mid-pull.
    5. Test the model with a one-shot generate; show the reply.
    6. Apply: persists `brainController` + `brainControllerConfig`
       and hot-swaps the active controller via `swapBrain()`.
  Hermes path: endpoint + key entry, `/v1/models` probe, profile
  picker, apply. Reachable from tray menu + Settings → Brain.
- **`local-llm` brain controller** (`src/main/brainControllers/localLlmBrain.ts`).
  Calls Ollama via `ollama-ai-provider` + Vercel AI SDK `generateObject`
  with a Zod discriminated-union action schema (`noop` / `idle_thought`
  / `wander` / `play_animation` / `nudge`). 5-min coarse cadence;
  90s idle floor; 45s hard timeout; in-flight mutex; silent degradation
  if the model is unreachable. Per-controller config: endpoint, model,
  temperature. Stored at `brainControllerConfig['local-llm']`.
- **`hermes` brain controller** (`src/main/brainControllers/hermesBrain.ts`).
  Same prompt + schema as local-llm but routed through an OpenAI-compatible
  Hermes endpoint with bearer auth from `hermes_api_key` secret. Config:
  endpoint, model (profile name), temperature.
- **Settings → Brain section.** Controller picker + "Open Brain Setup
  Wizard…" button. Switching takes effect immediately via `swapBrain()`.
- **Tray menu entry: `🧙 Brain Setup Wizard…`** beside Extensions.
- New IPC channels: `brainWizard:detectHardware`, `brainWizard:probeOllama`,
  `brainWizard:pullOllamaModel`, `brainWizard:pullProgress` (push), `brainWizard:cancelPull`,
  `brainWizard:testOllamaModel`, `brainWizard:probeHermes`, `brainWizard:apply`,
  `brainWizard:open`, `brainWizard:close`.
- New preload (`src/preload/brainWizard.ts`) + renderer
  (`src/renderer/brain-wizard/`) + window manager
  (`src/main/windows/brainWizardWindow.ts`).

- **Shared brain-models catalog** at `src/shared/brain-models-catalog.ts` —
  single source of truth for the 13 curated models (Qwen 2.5 0.5B/1.5B/7B,
  Qwen 2.5 Coder 3B/7B, Llama 3.2 1B/3B, Llama 3.1 8B, Llama 3.3 70B,
  Phi-3 Mini, Mistral 7B, Gemma 2 2B/9B). Each entry carries size, min-RAM,
  cold-load + warm-response time estimates, and notes. Imported by the
  wizard, Settings → Brain, and the tray Brain submenu so labels and time
  estimates stay in sync.
- **Brain model picker in Settings → Brain** — dropdown of all 13 curated
  models plus any installed-but-not-in-catalog models from `/api/tags`,
  with response-time estimates inline (`warm <1s` / `cold ~4-8s`).
  Switching models live (no restart) since each tick re-reads its config.
  Free-text custom-tag input for non-catalog models.
- **Tray → Brain submenu** quick-switcher: controller picker (Default /
  Local LLM / Hermes), 8-model fast-swap list with warm-response labels,
  "🧠 Test brain now" entry that fires a forced tick and pops a Windows
  notification with the chosen action, and "🧙 Setup Wizard..." shortcut.
- **🧠 Test brain now** button + IPC (`brain:forceTick`). Calls the
  active controller's `forceTick(ctx)` method which bypasses idle-floor +
  intent gates and returns a one-line action summary. Hooked from both
  Settings and tray.
- **Local-LLM auto-detect for the wizard**: scans the user's stored
  `ollamaEndpoint`, `OLLAMA_HOST` env var, and the running `ollama.exe`
  process (via `Get-NetTCPConnection -OwningProcess`) to find the actual
  listening port even when Ollama is on a non-default endpoint.
- **Mute Sound Effects** moved to Settings → Behavior as well (was
  tray-only). `muteSounds` added to `StoreSnapshot`.
- **OnboardingGuide-style verbiage** in Settings: top section relabeled
  **"Chat (Conversational LLM)"** and Brain section relabeled **"Brain
  (Autonomous LLM)"** with cross-referenced subtitles emphasizing they
  are independent — the chat model and the brain model do not have to
  match, and the default brain uses no LLM at all.

### Changed

- `BRAIN_CONTROLLERS` registry in `src/main/brainControllers/registry.ts`
  now exports three factories: `default`, `local-llm`, `hermes`. Each
  declares a `configSchema` (advisory — wizard doesn't render it; manual
  Settings edit may use it in a future revision).
- `SettingsApi.openBrainWizard()` + `forceBrainTick()` + `listOllamaModels()`
  added to the settings preload.
- Settings window now opens at **720×760** (was 560×720) and is resizable
  with `minWidth: 520` / `minHeight: 480`. The wider default lets the new
  Extensions 2-column grid render properly.
- Settings layout overhaul: Extensions section is now a CSS Grid
  (`repeat(auto-fill, minmax(220px, 1fr))`), packing the 28 boolean flags
  2-per-row at typical width. Select-type flags (drag-start / drag-end
  animation pickers) span both columns. Long descriptions wrap inline
  beneath each label. Killed the previous horizontal scrollbar with
  defensive `overflow-x: hidden` + `min-width: 0` rules. Behavior section's
  4 short toggles also pack in `.row-grid` 2-per-row.
- Settings "Display mode" label renamed to "Chat Style" to match the tray
  menu (carry-through from 0.4.0).

### Fixed

- **Critical: brain tick crash** in v0.5.0 alpha. The lazy `require()`
  pattern I used in `src/main/brainControllers/context.ts` to "dodge
  circular imports" doesn't survive electron-vite bundling — relative
  paths only exist in source, not in the bundled `out/main/index.js`.
  Every tick crashed with `Cannot find module '../animationController'`.
  Converted to static imports (there is no actual circular dep —
  animationController never reaches into brain controllers).
- **Wizard test timeout**: bumped from 45 s → 120 s. Cold-loading an 8B
  model on CPU-only systems can take 60-90 s for the first response.
  The test also passes `keep_alive: '15m'` so the model stays resident
  for the brain's actual first tick.
- **Brain `keep_alive`**: local-llm `generateObject` calls now pass
  `providerOptions: { ollama: { keepAlive: '15m' } }` so models don't
  get unloaded between ticks at our 5-min cadence (Ollama default is
  5 min — without this every other tick was a cold load).
- Settings checkbox sizing: the earlier 200 px `min-width` I added to
  `.row input` for text inputs was also applying to checkboxes, reserving
  a 200 px-wide slot for each one and pushing labels far to the right.
  Scoped the rule to `:not([type='checkbox']):not([type='radio'])`.

### Notes

- The two new LLM-backed controllers degrade silently. If Ollama is stopped,
  the model is deleted, the Hermes endpoint moves, or any tick times out,
  the controller logs the failure and returns to idle. Merlin keeps working
  in degraded mode; no notifications or crashes.
- Local-LLM brain ticks are bounded — the model can only emit one of five
  discriminated-union actions, all of which route through the same
  `BrainContext` methods used by the default brain. The LLM cannot send
  arbitrary IPC, move Merlin off-screen, or invoke tools.
- The `behavior.brain_controller.allow_override_actions` flag (shipped in
  0.4.0) is now load-bearing: when **off** (default), the LLM's actions
  still respect every behavior flag (e.g. wander stays disabled if the
  user turned `behavior.brain.wander` off); when **on**, the controller
  can override. Surfaced as "Allow brain to override behavior flags
  (advanced)" in the Extensions UI.

---

## [0.4.0] — 2026-05-19

Big plumbing release. Two headline features:

1. **Extensions system** — every Merlin behavior is now a togglable flag.
   28 flags across Drag / Brain / Animation / Voice / Visual / System
   categories, plus two select-type flags for picking which animation
   plays on drag start and drag end. New "Extensions" section in
   Settings (deep-linked from a tray menu entry). Zero behavior change
   for existing users — defaults match v0.3.x.
2. **Brain controller interface scaffolding** — the autonomous loop is
   now behind a swappable `BrainController` interface. The existing
   timer-based logic is the `'default'` controller. v0.5.0 will register
   `'local-llm'` (Ollama-driven) and `'hermes'` (Hermes Agent-driven)
   factories with no further interface changes.

Plus three bundled UX fixes for chat-style toggling that landed alongside.

### Added

- **`Extensions` settings section + tray menu entry** with 28 flags
  grouped by category. Booleans for on/off toggles (sway, halo, sleep
  timer, idle thoughts, etc.); select-type flags for *which* animation
  Merlin plays on drag start and drag end (default: MoveUp / auto-idle).
- **Shared catalog** at `src/shared/extensions-catalog.ts` is the single
  source of truth for the flag list — both the renderer UI and the
  main-process gate sites import from it.
- **Synchronous `isEnabled()` / `getValue()` API** in `src/main/extensions.ts`
  with a module-level cache, warmed at boot, invalidated when the user
  toggles a flag in Settings. Reads from hot paths (drag deltas at 30Hz,
  animation cycle ticks) cost an object lookup.
- **Body data-flag CSS gates** in the sprite renderer — drag visuals
  (scale, shadow, sway tilt) gate via `body[data-flag-drag-*]` attributes
  set from the live extensions snapshot. New `IPC.spriteSetExtensions`
  channel pushes updates to the renderer without a window reload.
- **Brain controller interface** at `src/main/brainControllers/types.ts`
  defining `BrainController`, `BrainContext`, and `BrainControllerFactory`.
  `BrainContext` exposes capabilities (sensing + acting) to controllers
  in a flag-aware way — calls to `wanderRandom()` / `emitIdleThought()`
  silently no-op if the matching flag is off (unless
  `behavior.brain_controller.allow_override_actions` is on).
- **`brainSupervisor.ts`** holds the active controller + singleton
  `BrainContext`. `startActiveBrain()` / `stopActiveBrain()` /
  `swapBrain()`. Hot-swap on `settingsSet` when `brainController` changes.
- **`'default'` controller** at `src/main/brainControllers/defaultBrain.ts`
  wraps the original `brain.ts` 60s tick logic. Identical behavior to v0.3.x.
- **`applyChatStyle()` helper** at `src/main/chatSurface.ts` — centralizes
  the Classic ↔ Modern chat-style toggle. Both the tray-menu radio and
  the settings IPC dispatch route through here, with hide-old-then-await-
  then-show-new sequencing so the two surfaces can't briefly co-render.

### Changed

- **Tray menu**: "Display mode" → **"Chat Style"** (pure rename; store
  key stays `displayMode`). Settings UI checkbox-row description
  rephrased accordingly.
- **Hide Merlin now hides the chat surface too** — bubble or panel
  hide alongside the sprite when you click "Hide Merlin" in the tray.
  Exception: if the user has focus in a chat input (typing or just-
  typed), the surface stays put so they don't lose their unsent text.
  Show Merlin re-opens whichever surface was visible before hide.
- **`brain.ts` is now a back-compat shim** re-exporting from the
  supervisor — existing callers (`markInteraction`,
  `noteIdleThoughtDismissed`, `startBrain`, `stopBrain`) still work
  unchanged.
- **`spriteGetInitial` payload** extended with `extensions` so the
  renderer can apply CSS gates from the first paint, no flash.
- **`StoreData` schema** gained three new top-level keys: `extensions`,
  `brainController`, `brainControllerConfig`. Existing keys
  (`idleThoughtsEnabled`, `showWelcomeOnStart`, `speakWelcome`,
  `screenshotHotkeyEnabled`, `autoStart`) are read at boot to seed the
  new `extensions` cache for backwards-compat. Left in the store as
  zombie fields until v0.6.0.

### Fixed

- **Both chat surfaces could briefly render simultaneously** during a
  Classic↔Modern toggle. Hide-old-await-then-show-new sequencing in
  `applyChatStyle()` eliminates the race.
- **Hide Merlin previously left the chat surface visible.** Now they
  hide together (focus-preserving).

### Migration notes

- All defaults are `true`/canonical — `extensions: {}` in the store
  means "use catalog defaults", so existing users open v0.4.0 with
  identical behavior.
- Legacy boolean keys are migrated on first boot:
  `idleThoughtsEnabled` → `behavior.brain.idle_thoughts`,
  `showWelcomeOnStart` → `behavior.voice.welcome`,
  `speakWelcome` → `behavior.voice.welcome_spoken`.
- v0.5.0 will deliver the actual `'local-llm'` and `'hermes'` brain
  controllers as new factories registered in
  `src/main/brainControllers/registry.ts`. The interface is locked.

---

## [0.3.1] — 2026-05-17

Hotfix: tray menu was missing the ElevenLabs option added in `0.3.0`.

### Fixed

- **Right-click → Voice submenu** now includes ElevenLabs alongside the
  other engines. Shows as disabled with "(no API key — set in Settings)"
  when no key is saved; enabled radio option when the key is present. The
  status line at the top of the tray menu also correctly reads
  "Voice: ElevenLabs" when that engine is selected.

---

## [0.3.0] — 2026-05-17

Same-day follow-up to `0.2.0`. Headline items: a new **ElevenLabs** TTS engine
with full Voice Library access, the speaking-gesture cycle now stays in sync
with actual audio playback (not just the LLM stream), clippyjs sound effects
auto-mute during TTS so they don't compete with the spoken response, idle
thoughts are no longer interruptive (they wait their turn AND become part of
the chat record when you reply to them), and there's finally a Stop button
for runaway voice.

### Added

- **ElevenLabs TTS engine.** Sixth voice option alongside Off / SAPI / Edge /
  Groq / OpenRouter. Curated dropdown of nine built-in voices (Rachel, Adam,
  Antoni, Bella, Domi, Elli, Josh, Arnold, Sam) plus a custom voice ID input
  so you can use any voice you've added from the public Voice Library.
  Default model is `eleven_multilingual_v2` for broad voice compatibility.
  API key stored via `safeStorage` like the other secrets.
- **Audio-gated speaking cycle.** When voice is enabled, the `'speaking'`
  intent (and its gesture cycle) now stays alive until TTS audio actually
  finishes playing — not just until the LLM stream completes. Sprite
  renderer reports its audio-queue state to main via a new IPC; main waits
  on both `waitForSynthDrain` (synthesis queue empty) and `waitForVoiceIdle`
  (renderer audio queue drained) before calling `chatEnd`. Merlin keeps
  gesturing through the entire spoken response, then transitions to idle.
- **Auto-mute clippyjs SFX during TTS.** The override on `HTMLMediaElement.
  prototype.play` now blocks animation sound effects whenever voice playback
  is active. Bonus: when voice starts, any SFX already mid-play gets paused
  immediately via a `silenceNonVoiceAudio()` helper.
- **Idle thoughts persist as part of the conversation record.** When you
  reply while an idle thought is visible, the thought is promoted to
  `permanent: true` — countdown chip and progress bar disappear, auto-expire
  is skipped, the header rephrases to "(thought)", and it stays in the
  chronological thread instead of fading. Still dismissible with `×`.
- **Stop / Mute control during voice playback.** Panel's existing Stop
  button now also appears when audio is still playing post-stream (label
  shifts to "Mute"). New "Stop Voice" item in the tray menu kills TTS audio
  from anywhere. Both paths route through the existing `cancelVoice`.
- **`Stop Voice` in tray menu** so you can interrupt without going through
  the chat panel.

### Changed

- **Idle thoughts interleave by timestamp** instead of always rendering at
  the bottom of the thread. When you reply to a chat that has an open idle
  thought, new turns now slot in *below* the thought instead of pushing it
  to the floor. Items render in chronological order (turn.timestamp vs
  thought.emittedAt).
- **Speaking-gesture palettes trimmed for short durations.** `Hearing_*`
  (4s each), `Process`/`Processing` (5-6s), `Reading` (9.7s) were causing
  visible overhang past the end of audio — the cycle would fire one near
  the audio's tail and the gesture would linger 3-9 seconds. All 8 mood
  palettes now favor short anims (`Explain` 0.6s, `Pleased` 0.5s, `Gesture*`
  0.5s, `Acknowledge` 0.75s), with at most one `Hearing_*` per palette as a
  flavor option.
- **Thinking cycle trimmed** from 10 anims to 3 short variants (`Think`
  0.8s, `Read` 2.5s, `Write` 3.2s). The `ing` variants (`Thinking` 7.4s,
  `Processing` 5.2s, `Reading` 9.7s) were outlasting the cycle interval and
  piling up in the queue, then continuing to play after `chatEnd`.
- **Hard-stops at chat lifecycle transitions** for crisp endings.
  `chatFirstReply`, `chatEnd`, and `chatAborted` now call `interruptCurrent()`
  before transitioning — cuts off any in-flight thinking/speaking gesture
  via `agent.stop()` so nothing overhangs past the moment Merlin should be
  idle. Previously the last-queued gesture would play its full ~2-3s past
  the actual end of audio.
- **ElevenLabs error notifications** are now non-silent and carry a status-
  specific hint:
  - `402` → "ElevenLabs free tier doesn't allow API access to Voice Library
    voices. Use a built-in voice or upgrade your plan."
  - `401`/`403` → "API key invalid or lacks permission for this voice."
  - `404` → "Voice ID not found. Add it from the Voice Library to your
    account first."
  - `422`/`400` → "Voice may not be in your account, or this model isn't
    supported for it."
  Plus the full API response body is logged at warn level for inspection.
- **Brain musings respect the agent-busy state.** Both `maybeWander` and
  `maybeIdleThought` now check `getIntent()` via an async-import of the
  animation controller (to avoid the circular dep) and skip the tick
  entirely while Merlin is `thinking`, `speaking`, or `doing`. No more
  thoughts popping into the panel mid-response.
- **`chatEnd` calls `markInteraction()`** so the brain's 90s idle countdown
  restarts from when the response actually finished, not when the user
  submitted (which could've been 60+ seconds earlier for long Hermes
  tool-using turns). Prevents idle thoughts from firing immediately after a
  long reply.

### Fixed

- **Settings checkbox-row labels** were clipped into vertical wraps by the
  `.row label { flex: 0 0 90px }` rule (the wider checkbox descriptions
  like "Idle thoughts (occasional unprompted remarks)" don't fit in 90px).
  Added a `:has(input[type="checkbox"])` selector that lets those labels
  take full row width.
- **`MoveUp` halo animation now visibly plays during drag.** Diagnosed via
  the new audio-state logging path: the actual fix was switching from the
  graceful-exit-branch `agent.stop()` to a direct animator switch
  (`hardSwitchTo`) that bypasses clippyjs's internal queue entirely. (This
  was in `0.2.0` but is mentioned again because the supporting `0.3.0`
  diagnostics let us actually confirm it works end-to-end.)
- **`programmatic()` no-op skip** — covered in the `0.2.0` notes but
  extended here to the smooth-move bubble + panel paths too.

---

## [0.2.0] — 2026-05-17

Post-`0.1.0` polish, refactors, and feature work. Headline items: the modern
chat panel is now a proper bubble-style companion to the sprite (follows on
drag, has a tail, auto-flips at screen edges), Merlin's drag animation actually
plays now, the animation/state controller got a robustness pass, and idle
thoughts surface as transient panel turns with a countdown.

### Added

- **Drag animation (MoveUp / copter-hat).** Merlin plays his "being carried"
  gesture as soon as you start dragging him — the halo appears above his
  hat through the drag. Implemented via a direct switch into clippyjs's
  internal animator (`ClippyController.hardSwitchTo`), bypassing clippyjs's
  normal queue which would otherwise wait for the currently-running
  animation to gracefully exit-branch first.
- **Pendulum sway during drag.** Smoothed horizontal drag velocity drives a
  CSS `rotate()` tilt on the sprite via a `--merlin-drag-tilt` variable.
  Subtle "swing" toward the leading direction, decays back to upright when
  the cursor pauses. Pure GPU-composited transform.
- **Thinking-gesture cycle.** While the LLM is generating a response,
  Merlin now cycles through a pool of `Think`/`Thinking`/`Process`/
  `Processing`/`Read`/`Reading`/`Write`/`Writing`/`Search`/`Searching`
  every 3–5.5s. Long Hermes tool-using turns (10–30s) no longer leave him
  frozen on a single Think frame.
- **Random double-click animation.** Pool of 13 playful gestures
  (`Pleased`/`Wave`/`Greet`/`Surprised`/`Acknowledge`/`GestureRight`/
  `GestureLeft`/`Congratulate`/`Congratulate_2`/`DoMagic1`/`DoMagic2`/
  `GetAttention`/`Alert`), picked via the recent-anim ring buffer so
  back-to-back double-clicks actually look different.
- **Modern chat panel follows Merlin.** The panel is now bound to the sprite
  the way the speech bubble is: drag either window and the other follows
  in lockstep, the panel's tail tracks Merlin's actual position (offset
  slides along the chosen edge), and the panel flips to the opposite side
  of the sprite when it would otherwise land off-screen. This includes
  following during *autonomous* moves — brain wander, idle-thought
  nudges, `move_to` / `move_relative` tool calls all carry the panel along.
- **Bounds check after autonomous moves.** If Merlin glides into a screen
  corner via a smooth move, the bubble / panel auto-flip to the other side
  of him instead of being clipped off-screen.
- **Idle thoughts in the modern panel.** Merlin's periodic musings (welcome,
  time-of-day nudges, task reminders) render in the chat panel as transient
  amber "thought" turns when modern mode is active. Each shows a `⏱ N sec`
  countdown chip + a draining progress bar at the bottom, auto-removes
  after 120s, and can be clicked to engage (pre-fills the input) or
  dismissed with ×.
- **Auto-scroll on new idle thought.** Panel scrolls to bottom when a
  thought is added but not when one expires — never yanks the scroll
  position out from under you.
- **`CHANGELOG.md`.** This file.

### Changed

- **`AnimationController` state machine.** Big refactor for robustness:
  - Centralized `setIntent(next, reason)` helper — every transition logs
    `prev → next (reason)` and auto-manages sleep / eye / reaction /
    thinking / speaking cycle timers, so timers can't be orphaned by a
    forgotten call.
  - `scheduleReactionFinish(ms)` guarantees every ephemeral reaction
    (click, drag, zoom, blur, focus) returns to `idle` within a known
    window. Previously double-click / right-click / zoom had no timeout
    and would freeze the controller at `'reacting'` indefinitely.
  - Safety-net periodic check forces `reacting → idle` if it lingers
    > 5s (catches missed callbacks, renderer-side crashes, etc.).
- **Sleepy animation palette.** `RestPose` removed from the sleepy
  `fidget` / `speaking` / `failure` sets — that's the static "sleep pose"
  reserved for the actual sleep timer, and using it as a fidget made
  Merlin look like he was dozing off mid-interaction.
- **Palette injection** now requires both late-night AND low energy (was
  either alone) — prevents morning sleepy fidgets just because energy
  drained overnight.
- **Energy model rebalanced.** Floor at 20 (was 0), decay 0.5/min (was
  1/min), night multiplier 1.4× (was 2×), interaction boost 15 (was 5).
  Merlin no longer drains to catatonic from being left alone overnight.
- **`reactToDragEnd` no longer interrupts the in-flight `MoveUp`.** It was
  calling `interruptCurrent()` which wiped the queued animation right when
  you released — that's why MoveUp never seemed to play. Now it transitions
  state without killing the animation and schedules a calm idle pose
  ~1.5s after release.
- **Idle-thought cadence**: cooldown 25min → 5min, per-tick chance 6% → 12%.
  Brain's musings actually surface during normal use instead of feeling
  perpetually rare.
- **Idle-thought countdown label** now reads `⏱ 25 sec` (clock emoji + bold
  number + small "sec") instead of `25s` — the previous "s" looked like
  a "5" at small font sizes.
- **`setPosition` throttling**: the IPC drag handler now accumulates deltas
  in main and flushes window moves at ~30Hz instead of per-incoming-IPC.
  Halves the OS-level move events and gives clippyjs's setTimeout-driven
  frame cycling room to render `MoveUp` during the drag.
- **Modern panel architecture:** outer window is transparent so the panel's
  CSS tail can stick out past the dark interior. `.app` shell drops
  `overflow: hidden` (was clipping the tail); titlebar / composer get
  matching rounded corners to preserve the visual.

### Fixed

- **`programmatic()` counter leak** that caused the chat panel (and bubble)
  to silently stop following the sprite after Merlin had wandered a few
  times. `setPosition` with the same rounded coords doesn't fire a move
  event on Windows — so the per-call counter would increment without
  decrementing, eventually swallowing real user-drag move events.
  Slow autonomous moves (brain wander) leaked the worst since sub-pixel
  ticks rounded to no-op for most of their duration. Now every
  `programmatic*Position` / `programmatic*MoveBy` helper short-circuits
  when the target coords match the current ones.
- **Speech bubble didn't follow Merlin when dragged** in classic mode
  because `moveSync`'s callback was capturing a stale sprite-window
  reference — now re-resolved every tick.
- **Drag animation visibility** was blocked by `.clippy` getting promoted
  to its own GPU layer (`will-change: transform`, `perspective(...)`,
  `filter`). Removed the layer-promoting properties so clippyjs's
  background-position frame swap commits in sync with paint.
- **`RestPose`** (the "asleep" pose) was getting picked by the regular idle
  scheduler at night / low energy. See "Changed → Sleepy palette."
- **`'reacting'`** state could get stuck forever after a click that didn't
  lead to chat; sleep timer would then never re-arm and eye-tracking would
  never fire. See "Changed → state machine."
- **Welcome message was silent in modern mode** (bubble was suppressed,
  panel wasn't notified). Now appears as an idle-thought turn in the panel
  with a retry loop in case the panel is still loading at welcome time.

---

## [0.1.0] — 2026-05-17

Initial public release. Repository made open-source under MIT and published
to <https://github.com/therealgorgan/merlin-the-wizard>.

### Added

#### Core sprite + window architecture

- Electron app with three small windows: transparent click-through sprite,
  speech bubble, settings.
- Original Microsoft Agent **Merlin** sprite rendered via `clippyjs` with
  jQuery 3.5.1 bundled locally.
- Drag-the-sprite-anywhere via pointer events; tray icon with Hide/Show,
  character picker, mode toggle, Settings, Quit.
- Global summon hotkey (`Ctrl+Shift+M` by default, rebindable).
- Multi-monitor + DPI scaling support.
- Classic vs Retouched sprite appearance toggle (CSS-smoothed alternative
  for the original pixel-art look).
- Custom character support — drop a clippyjs-format folder into the
  characters directory and it appears in the picker.

#### LLM providers

- Multi-provider chat behind a single `LLMProvider` interface.
  - **Groq** (OpenAI-compatible)
  - **OpenRouter**
  - **Ollama** (local)
  - **MiniMax** (OpenAI-compatible)
  - **Hermes Agent** (self-hosted MCP-native runtime, multi-profile via
    tray submenu)
- Provider/model picker per-provider, API keys stored via Electron
  `safeStorage` (Windows DPAPI).
- Conversation history persisted, rotating cap.

#### Animation protocol

- Streaming `[anim:Name]`, `[feel:Mood]`, `[suggest:Text]` inline tags
  parsed from LLM stream, dispatched to sprite/mood/suggestions
  independently of the visible text.
- `FunctionCallParser` fallback for `<function=name>{...}</function>`
  style tool calls.
- Italic action narration filter (strips `*does a thing*` from voice and
  bubble while letting it through to history).

#### Voice

- **STT (push-to-talk)**: MediaRecorder in renderer → Whisper transcription
  back via API of choice. Mic button in bubble + chat panel.
- **TTS**: pluggable engine (`Edge`, `SAPI`, `Groq`, `OpenRouter`, off);
  sentence-by-sentence dispatch via `SentenceSplitter` so reply audio
  starts within ~1.5s of first text.
- Bubble + voice sync: text held back until audio is ready so the bubble
  doesn't appear empty or silent.

#### Tools

- `web_search` (Tavily + DuckDuckGo Instant Answer)
- `screen_capture` (Electron `desktopCapturer`)
- `move_to` (named screen corners) and `move_relative` (left/right/up/down
  × small/medium/large) — both with directional `Move*` glide animation
- Task tools: `add_task`, `complete_task`, `remove_task`, `list_tasks`
- Confirm-flow IPC with default-focus `Reject` on destructive actions

#### AnimationController v1

- Intent state machine: `hidden | sleeping | idle | reacting | thinking | speaking | doing`
- Mood-weighted animation palettes (cheerful / thoughtful / mischievous /
  puzzled / sad / sleepy / curious / pleased)
- Time-of-day + energy modulation
- Eye-tracking toward the cursor while idle
- Speaking-gesture cycle during voice playback
- Recent-anim ring buffer to bias picks away from back-to-back repeats
- Sleep / wake-on-interaction
- Tool-outcome reactions (success / failure → mood-appropriate gesture)
- Content reactions (thanks / wow / "what?" → matching gesture)
- App focus / blur subtle reactions
- 24 boot greetings (12 daytime, 12 nighttime), spoken + bubble variants

#### Display modes

- **Classic** mode: floating sprite + on-demand speech bubble with a CSS
  tail that points at Merlin and slides along the bubble edge to track
  his actual position.
- **Modern** mode: floating sprite + persistent chat panel docked alongside.
- Mode toggle in the right-click tray menu.
- Bubble is resizable and follows sprite during drag.

#### Chat surfaces

- Speech bubble in classic mode: streaming markdown render, suggestion
  chips, attachment chips (drag-drop files + screenshots), mic button.
- Chat panel in modern mode: full conversation thread, regenerate button,
  drag-drop attachments, voice input, screen capture, suggestions.

#### Settings

- Provider, model, API keys per provider
- Voice engine + voice name (with `Get-Voice` enumeration for SAPI)
- Custom character browser + reload + "open characters folder"
- Hermes profile discovery (per-port probe across 8642–8654) + active
  profile selection
- Personality preset (balanced / heavy medieval / competence-first)
- Auto-start with Windows toggle
- Display mode + sprite appearance toggles
- Summon hotkey rebind

#### Packaging / OSS

- MIT license
- Author: `therealgorgan`
- `.env.example` with placeholders for all provider keys
- `README.md` with architecture diagram, features, setup, build
- `docs/integrating-hermes.md` (scrubbed of any private IPs/tokens)
- Public GitHub repo at <https://github.com/therealgorgan/merlin-the-wizard>

[Unreleased]: https://github.com/therealgorgan/merlin-the-wizard/compare/v0.6.3...HEAD
[0.6.3]: https://github.com/therealgorgan/merlin-the-wizard/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/therealgorgan/merlin-the-wizard/compare/v0.6.1...v0.6.2
[0.4.0]: https://github.com/therealgorgan/merlin-the-wizard/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/therealgorgan/merlin-the-wizard/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/therealgorgan/merlin-the-wizard/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/therealgorgan/merlin-the-wizard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/therealgorgan/merlin-the-wizard/releases/tag/v0.1.0
