# Changelog

All notable changes to **Merlin the Wizard** are tracked here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project loosely follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

Nothing yet.

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

[Unreleased]: https://github.com/therealgorgan/merlin-the-wizard/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/therealgorgan/merlin-the-wizard/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/therealgorgan/merlin-the-wizard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/therealgorgan/merlin-the-wizard/releases/tag/v0.1.0
