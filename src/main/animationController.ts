import { screen } from 'electron';
import { IPC } from '@shared/ipc-contract';
import { IDLE_ANIMATIONS, isAnimationName, type AnimationName } from '@shared/animations';
import {
  getSpriteWindow,
  hideMerlinWithAnimation,
  showMerlinWithAnimation,
  wiggleSprite,
} from './windows/spriteWindow';
import { getActiveSpriteHost } from './activeSurface';
import { getMood, type Mood } from './feelings';
import { logger } from './logger';

// Central animation brain. Five jobs:
//   1. Track Merlin's intent (sleeping/idle/reacting/thinking/speaking/doing/hidden).
//   2. Route animation IPC to whichever surface hosts the sprite (classic
//      sprite window vs modern panel's embedded clippyjs).
//   3. Map high-level lifecycle events (user interaction, chat lifecycle, tool
//      execution) to context-appropriate sprite animations.
//   4. Pick animations *intelligently* — mood-weighted, with a recent-anim
//      ring buffer to avoid back-to-back repetition.
//   5. Drive proactive behaviors on its own timers: eye-tracking toward the
//      cursor, long-idle drift into sleep, wake-on-interaction.

export type Intent =
  | 'sleeping' | 'idle' | 'reacting' | 'thinking' | 'speaking' | 'doing' | 'hidden';

let intent: Intent = 'idle';

// ── Time of day + energy ────────────────────────────────────────────────────
//
// Energy is a 0–100 internal counter that captures "how peppy is Merlin right
// now." It governs animation density (sparser when low), animation selection
// (calmer when low), and reaction probability (skip more reactions when low).
//
// Energy drains slowly while idle, drains faster late at night, recovers on
// activity (user interactions, successful tools, replies sent), and resets
// upward after a long sleep.
//
// Time-of-day is consulted alongside mood when biasing animation picks — at
// night even a cheerful Merlin tilts toward calmer gestures.

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

function timeOfDay(d: Date = new Date()): TimeOfDay {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

let energy = 70; // 0-100, starts moderate
let lastEnergyUpdate = Date.now();
let sleepStartedAt = 0;
// Floor so Merlin never goes fully drained — at very low energy he'd look
// catatonic, picking only the sleepy palette indefinitely. 20 is "tired but
// still responsive."
const ENERGY_MIN = 20;

function decayEnergy(): void {
  const now = Date.now();
  const minutes = (now - lastEnergyUpdate) / 60_000;
  lastEnergyUpdate = now;
  if (minutes <= 0) return;
  // Base decay: 0.5 energy per minute idle. Slower than before so a few
  // hours away from the keyboard doesn't leave Merlin at zero next time
  // the user comes back.
  let drain = minutes * 0.5;
  // Late night (22:00–6:00) drains 1.4x faster (was 2x — too aggressive).
  const tod = timeOfDay();
  if (tod === 'night') drain *= 1.4;
  // While actually sleeping, restore (Merlin "rests up").
  if (intent === 'sleeping' && sleepStartedAt > 0) {
    const sleptMinutes = (now - sleepStartedAt) / 60_000;
    if (sleptMinutes > 5) {
      energy = Math.max(energy, Math.min(85, 55 + sleptMinutes * 2));
    }
    return; // don't drain while sleeping
  }
  energy = Math.max(ENERGY_MIN, energy - drain);
}

function gainEnergy(amount: number): void {
  decayEnergy();
  energy = Math.min(100, energy + amount);
}

/** 0–1 multiplier for "how energetic is Merlin right now." */
function energyFactor(): number {
  decayEnergy();
  return Math.max(0.1, energy / 100);
}

export function getEnergy(): number {
  decayEnergy();
  return Math.round(energy);
}

export function getTimeOfDay(): TimeOfDay { return timeOfDay(); }

// ── Send + variety tracking ──────────────────────────────────────────────────

// Ring buffer of recently played animations — used to bias random picks AWAY
// from animations we *just* played, so the idle/speaking cycles don't repeat
// the same gesture twice in a row.
const RECENT_SIZE = 4;
const recentAnims: AnimationName[] = [];

function rememberAnim(name: AnimationName): void {
  recentAnims.push(name);
  while (recentAnims.length > RECENT_SIZE) recentAnims.shift();
}

// A Merlin animation in clippyjs takes roughly 1.5–3s to play. The renderer
// queues anything we send, so if the controller fires more than 1 animation
// per ~2.5s the queue piles up and the user sees gestures playing for many
// seconds after the triggering event has long ended. To prevent that:
//
//   - Most sends are "casual" — they DROP if another animation was queued
//     within the typical-duration window (currently 2500ms).
//   - Sends that represent a real state transition or user-facing immediate
//     reaction pass {important: true} to bypass the throttle.
//
// This keeps Merlin's animation density manageable without hand-tuning every
// trigger's frequency.

const ANIM_TYPICAL_MS = 2500;
let lastSendAt = 0;

interface SendOpts { important?: boolean }

function send(name: AnimationName, opts: SendOpts = {}): void {
  if (!isAnimationName(name)) return;
  const now = Date.now();
  if (!opts.important && now - lastSendAt < ANIM_TYPICAL_MS) {
    // Drop — Merlin's likely still mid-gesture. The next scheduled tick will
    // pick something fresh instead of piling on.
    return;
  }
  lastSendAt = now;
  rememberAnim(name);
  void getActiveSpriteHost().then((w) => {
    w?.webContents.send(IPC.spritePlay, name);
  });
}

/** Hard-stop the current animation + clear the renderer's queue. Used when we */
/** need the next animation to start RIGHT NOW (drag start/end being the */
/** canonical case — a drag is the user yanking Merlin around, so whatever */
/** subtle Look or Idle was playing should be cut short). Also resets the */
/** send-throttle so the following send() call doesn't get dropped. */
function interruptCurrent(): void {
  lastSendAt = 0;
  void getActiveSpriteHost().then((w) => {
    w?.webContents.send(IPC.spriteStop);
  });
}

/** Pick one of `candidates`, biased away from the recent ring buffer. */
function pickAnim(candidates: readonly AnimationName[]): AnimationName | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  const fresh = candidates.filter((c) => !recentAnims.includes(c));
  const pool = fresh.length > 0 ? fresh : candidates;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

// ── Mood-weighted candidate sets ─────────────────────────────────────────────
//
// Each mood tilts random selection toward animations that feel in-character.
// `fidget`: short reactive gestures (user did something, default idle nudge).
// `speaking`: short "I'm talking" gestures during voice playback.
// `wake`: animation played when Merlin wakes from sleep.
// `success`: positive tool/result reaction.
// `failure`: negative tool/result reaction.

interface MoodPalette {
  fidget: readonly AnimationName[];
  speaking: readonly AnimationName[];
  wake: readonly AnimationName[];
  success: readonly AnimationName[];
  failure: readonly AnimationName[];
  thank: readonly AnimationName[];   // "thanks" reaction
  surprise: readonly AnimationName[]; // "!" reaction
  confusion: readonly AnimationName[]; // user is vague / "?" repeated
}

// Speaking-cycle animation pools deliberately bias toward short durations
// (Explain 0.6s, Pleased 0.5s, Gesture* 0.5s, Acknowledge 0.75s). The longer
// Hearing_* animations (4s each) cause visible overhang when fired near the
// end of TTS audio playback — the cycle stops scheduling new ones at
// chatEnd, but a Hearing that just started would still have ~3s left to
// play. Keep at most one Hearing variant per palette as a flavor option.

const PALETTES: Record<Mood, MoodPalette> = {
  cheerful: {
    fidget: ['Pleased', 'Acknowledge', 'Wave', 'Surprised'],
    speaking: ['Explain', 'Pleased', 'Acknowledge', 'GestureLeft', 'GestureRight', 'Hearing_1'],
    wake: ['Greet', 'Wave', 'Pleased'],
    success: ['DoMagic1', 'Pleased', 'Congratulate'],
    failure: ['Confused', 'Uncertain'],
    thank: ['Pleased', 'Congratulate', 'Acknowledge'],
    surprise: ['Surprised', 'Alert'],
    confusion: ['Confused', 'Uncertain'],
  },
  thoughtful: {
    fidget: ['LookLeft', 'LookRight', 'Acknowledge', 'Idle1_1'],
    speaking: ['Explain', 'Acknowledge', 'GestureLeft', 'GestureRight', 'Hearing_3'],
    wake: ['Acknowledge', 'Explain'],
    success: ['Acknowledge', 'DoMagic2', 'Pleased'],
    failure: ['Confused', 'LookDown'],
    thank: ['Acknowledge', 'Pleased'],
    surprise: ['Surprised', 'LookUp'],
    confusion: ['Think', 'Uncertain'],
  },
  mischievous: {
    fidget: ['GestureLeft', 'GestureRight', 'Surprised', 'Wave'],
    speaking: ['GestureLeft', 'GestureRight', 'Pleased', 'Explain', 'Acknowledge'],
    wake: ['Surprised', 'Wave', 'GetAttention'],
    success: ['DoMagic1', 'DoMagic2', 'Congratulate_2'],
    failure: ['Confused', 'Surprised'],
    thank: ['Pleased', 'Wave'],
    surprise: ['Surprised', 'Alert', 'GetAttention'],
    confusion: ['Confused', 'Surprised'],
  },
  puzzled: {
    fidget: ['Confused', 'Uncertain', 'LookLeft', 'LookRight'],
    speaking: ['Explain', 'Acknowledge', 'Uncertain', 'GestureLeft', 'Hearing_1'],
    wake: ['Confused', 'Acknowledge'],
    success: ['Pleased', 'Acknowledge'],
    failure: ['Confused', 'DontRecognize', 'Sad'],
    thank: ['Acknowledge'],
    surprise: ['Surprised', 'Confused'],
    confusion: ['Confused', 'DontRecognize', 'Uncertain'],
  },
  sad: {
    fidget: ['Sad', 'LookDown', 'Acknowledge', 'Idle1_1'],
    speaking: ['LookDown', 'Acknowledge', 'Explain', 'Hearing_3'],
    wake: ['Acknowledge', 'Sad'],
    success: ['Acknowledge', 'Pleased'],
    failure: ['Sad', 'LookDown'],
    thank: ['Acknowledge'],
    surprise: ['Surprised'],
    confusion: ['Confused', 'Sad'],
  },
  sleepy: {
    // No RestPose anywhere — it's the static "sleep pose" reserved for the
    // sleep timer fire. Using it as a fidget made Merlin look like he was
    // dozing off mid-interaction. Picked calmer Look/Idle gestures instead.
    fidget: ['LookDownBlink', 'LookDown', 'Idle1_1', 'Idle2_1', 'Blink'],
    speaking: ['Acknowledge', 'Explain', 'Blink'],
    wake: ['LookUp', 'Acknowledge'],
    success: ['Pleased', 'Acknowledge'],
    failure: ['Confused', 'LookDown'],
    thank: ['Acknowledge', 'Pleased'],
    surprise: ['Surprised', 'LookUp'],
    confusion: ['Confused', 'Uncertain'],
  },
  curious: {
    fidget: ['LookLeft', 'LookRight', 'LookUp', 'Search'],
    speaking: ['Explain', 'GestureLeft', 'GestureRight', 'Acknowledge', 'LookUp'],
    wake: ['LookUp', 'Greet', 'Surprised'],
    success: ['Pleased', 'DoMagic1'],
    failure: ['Confused', 'LookDown'],
    thank: ['Pleased', 'Acknowledge'],
    surprise: ['Surprised', 'Alert', 'LookUp'],
    confusion: ['Confused', 'Search'],
  },
  pleased: {
    fidget: ['Pleased', 'Acknowledge', 'Wave', 'Congratulate'],
    speaking: ['Pleased', 'Explain', 'Acknowledge', 'GestureRight', 'Hearing_1'],
    wake: ['Greet', 'Wave', 'Pleased'],
    success: ['DoMagic2', 'Congratulate', 'Congratulate_2'],
    failure: ['Confused'],
    thank: ['Pleased', 'Congratulate'],
    surprise: ['Surprised'],
    confusion: ['Confused', 'Uncertain'],
  },
};

async function palette(): Promise<MoodPalette> {
  const m = await getMood();
  // Mood-driven base palette. Time-of-day + energy can TILT picks toward
  // calmer or peppier gestures, but only at clear thresholds so the moods
  // don't all blur into "sleepy" after a few hours of idle.
  let base = PALETTES[m] ?? PALETTES.cheerful;
  const tod = timeOfDay();
  const veryLowEnergy = energy < 35;
  const highEnergy = energy >= 70;
  const lateNight = tod === 'night';

  // Only inject sleepy gestures when BOTH conditions hit (low energy AND late
  // night) — single condition alone isn't enough to override Merlin's actual
  // mood. Prevents the "sleepy fidgets all morning because he didn't sleep"
  // problem and the "sleepy fidgets right after interaction" problem.
  if (veryLowEnergy && lateNight) {
    const sleepy = PALETTES.sleepy;
    base = {
      fidget: [...base.fidget, ...sleepy.fidget],
      speaking: [...base.speaking, ...sleepy.speaking],
      wake: base.wake,
      success: base.success,
      failure: base.failure,
      thank: base.thank,
      surprise: base.surprise,
      confusion: base.confusion,
    };
  } else if (tod === 'morning' && highEnergy) {
    // High-energy mornings: tilt toward cheerful for extra pep.
    const peppy = PALETTES.cheerful;
    base = {
      fidget: [...base.fidget, ...peppy.fidget],
      speaking: base.speaking,
      wake: [...peppy.wake, ...base.wake],
      success: [...peppy.success, ...base.success],
      failure: base.failure,
      thank: base.thank,
      surprise: base.surprise,
      confusion: base.confusion,
    };
  }
  return base;
}

// ── Speaking gesture cycle (during voice playback) ───────────────────────────

let speakingTimer: NodeJS.Timeout | null = null;
const SPEAKING_GESTURE_MIN_MS = 6_000;
const SPEAKING_GESTURE_MAX_MS = 12_000;

function clearSpeakingTimer(): void {
  if (speakingTimer) {
    clearTimeout(speakingTimer);
    speakingTimer = null;
  }
}

function scheduleNextSpeakingGesture(): void {
  clearSpeakingTimer();
  // High energy = more frequent gestures (~4-7s). Low energy = sparser (~7-12s).
  const e = energyFactor();
  const base = SPEAKING_GESTURE_MIN_MS + (1 - e) * 3_000;
  const span = (SPEAKING_GESTURE_MAX_MS - SPEAKING_GESTURE_MIN_MS) * (0.7 + e * 0.6);
  const ms = base + Math.random() * span;
  speakingTimer = setTimeout(async () => {
    speakingTimer = null;
    if (intent !== 'speaking') return;
    const pal = await palette();
    const pick = pickAnim(pal.speaking);
    if (pick) send(pick);
    scheduleNextSpeakingGesture();
  }, ms);
}

// ── Thinking gesture cycle (while LLM is generating) ─────────────────────────
//
// Long LLM turns (especially Hermes tool-using flows) can take 10-30s. Without
// a cycle, Merlin fires Think once at chatStart and then just stands there
// looking blank for the rest of the wait. The cycle re-fires a thinking-flavor
// animation every 3-6s so the user has constant feedback that something is
// actually happening.

// Short-duration only — the "ing" variants (Thinking 7.4s, Processing 5.2s,
// Reading 9.7s, Writing 6.4s, Searching 6.3s) outlast the cycle interval and
// pile up in the queue, then keep playing well after chatEnd. The short
// variants (Think 0.8s, Read 2.5s, Write 3.2s) fit cleanly inside one cycle.
const THINKING_ANIMATIONS: readonly AnimationName[] = [
  'Think',
  'Read',
  'Write',
];

let thinkingTimer: NodeJS.Timeout | null = null;
const THINKING_GESTURE_MIN_MS = 3_000;
const THINKING_GESTURE_MAX_MS = 5_500;

function clearThinkingTimer(): void {
  if (thinkingTimer) {
    clearTimeout(thinkingTimer);
    thinkingTimer = null;
  }
}

function scheduleNextThinkingGesture(): void {
  clearThinkingTimer();
  const ms = THINKING_GESTURE_MIN_MS + Math.random() * (THINKING_GESTURE_MAX_MS - THINKING_GESTURE_MIN_MS);
  thinkingTimer = setTimeout(() => {
    thinkingTimer = null;
    if (intent !== 'thinking') return;
    const pick = pickAnim(THINKING_ANIMATIONS);
    if (pick) send(pick, { important: true });
    scheduleNextThinkingGesture();
  }, ms);
}

// ── Sleep / wake ─────────────────────────────────────────────────────────────

let sleepTimer: NodeJS.Timeout | null = null;
const SLEEP_AFTER_MS = 20 * 60_000; // 20 minutes of true idle → sleep

function clearSleepTimer(): void {
  if (sleepTimer) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
  }
}

function armSleepTimer(): void {
  clearSleepTimer();
  if (intent !== 'idle') return;
  sleepTimer = setTimeout(() => {
    sleepTimer = null;
    if (intent !== 'idle') return;
    logger.debug('AnimationController: drifting to sleep (energy=', getEnergy(), ')');
    sleepStartedAt = Date.now();
    setIntent('sleeping', 'sleep timer fired');
    send('RestPose', { important: true });
  }, SLEEP_AFTER_MS);
}

/** Wake Merlin if asleep — fired on any deliberate user input. */
async function wakeIfSleeping(): Promise<void> {
  if (intent !== 'sleeping') return;
  decayEnergy();
  sleepStartedAt = 0;
  gainEnergy(15);
  logger.debug('AnimationController: waking from sleep (energy=', getEnergy(), ')');
  const pal = await palette();
  const pick = pickAnim(pal.wake) ?? 'Greet';
  setIntent('reacting', 'waking from sleep');
  send(pick, { important: true });
  scheduleReactionFinish(1800);
}

// Mark any reactive event as "interaction happened" — resets sleep timer,
// credits energy, and wakes from sleep if needed.
function touchInteraction(): void {
  clearSleepTimer();
  gainEnergy(15);
  if (intent === 'sleeping') {
    void wakeIfSleeping();
    return;
  }
  // setIntent('idle', ...) below in callers will re-arm sleep; here we just
  // make sure the timer doesn't run from a stale armed state.
}

// ── Intent state machine ────────────────────────────────────────────────────
//
// All intent transitions go through setIntent so timer management is
// guaranteed consistent. Every reactive state schedules its own return-to-
// idle (scheduleReactionFinish) AND we have a safety-net periodic check that
// forces idle if 'reacting' lingers too long — that catches missed timeouts
// and orphan reactions that used to freeze the whole controller.

let reactingStartedAt = 0;
let reactionFinishTimer: NodeJS.Timeout | null = null;
const REACTING_SAFETY_NET_MS = 5_000;

function clearReactionFinishTimer(): void {
  if (reactionFinishTimer) {
    clearTimeout(reactionFinishTimer);
    reactionFinishTimer = null;
  }
}

/** Schedule an automatic return from 'reacting' to 'idle' after `ms`. Cancels
 *  any previously-scheduled return so chained reactions don't fight. */
function scheduleReactionFinish(ms: number): void {
  clearReactionFinishTimer();
  reactionFinishTimer = setTimeout(() => {
    reactionFinishTimer = null;
    if (intent === 'reacting') {
      setIntent('idle', 'reaction finished');
    }
  }, ms);
}

/** Central intent transition. Logs, manages sleep/eye/reaction/cycle timers,
 *  and enforces invariants. Use this everywhere — never mutate `intent`
 *  directly. */
function setIntent(next: Intent, reason: string): void {
  if (next === intent) return;
  const prev = intent;
  intent = next;
  logger.debug(`AnimationController: ${prev} → ${next} (${reason})`);

  // Reaction-finish timer is per-reacting-stint. Clear unconditionally and
  // re-arm only if entering reacting.
  clearReactionFinishTimer();
  // Cycle timers belong to their owning state — clear when leaving so a
  // stray tick doesn't fire after the state changed.
  if (prev === 'thinking' && next !== 'thinking') clearThinkingTimer();
  if (prev === 'speaking' && next !== 'speaking') clearSpeakingTimer();

  if (next === 'reacting') {
    reactingStartedAt = Date.now();
    // Eye tracking + sleep both off during reacting (callers re-arm on exit).
    clearSleepTimer();
  } else if (next === 'idle') {
    armSleepTimer();
    scheduleNextEyeCheck();
  } else if (next === 'sleeping' || next === 'hidden') {
    clearSleepTimer();
    clearEyeTimer();
  } else if (next === 'thinking' || next === 'speaking' || next === 'doing') {
    clearSleepTimer();
    clearEyeTimer();
  }
}

// ── Eye-tracking ─────────────────────────────────────────────────────────────
//
// Every ~5s, glance at the actual cursor position. Computes which direction
// the cursor is relative to Merlin's window center and fires LookLeft/Right/
// Up/Down. Only runs while idle — speaking/reacting/thinking states are too
// busy to add gaze on top.

let eyeTimer: NodeJS.Timeout | null = null;
const EYE_CHECK_MIN_MS = 12_000;
const EYE_CHECK_MAX_MS = 22_000;
const EYE_DEADZONE_PX = 60; // cursor close to sprite center = no look (it'd be jittery)

function clearEyeTimer(): void {
  if (eyeTimer) {
    clearTimeout(eyeTimer);
    eyeTimer = null;
  }
}

function scheduleNextEyeCheck(): void {
  clearEyeTimer();
  // Energy modulates: sleepy Merlin glances less often (~10-18s), energetic
  // glances often (~4-9s). Sleeping Merlin doesn't glance at all.
  if (intent === 'sleeping') return;
  const e = energyFactor();
  const base = EYE_CHECK_MIN_MS + (1 - e) * 5_000;
  const span = (EYE_CHECK_MAX_MS - EYE_CHECK_MIN_MS);
  const ms = base + Math.random() * span;
  eyeTimer = setTimeout(() => {
    eyeTimer = null;
    try { tickEyeTracking(); } catch (err) { logger.warn('eye tick failed', err); }
    scheduleNextEyeCheck();
  }, ms);
}

function tickEyeTracking(): void {
  if (intent !== 'idle') return;
  const w = getSpriteWindow();
  if (!w) return;
  const [sx, sy] = w.getPosition();
  const [sw, sh] = w.getSize();
  const cx = (sx ?? 0) + (sw ?? 0) / 2;
  const cy = (sy ?? 0) + (sh ?? 0) / 2;
  const cursor = screen.getCursorScreenPoint();
  const dx = cursor.x - cx;
  const dy = cursor.y - cy;
  if (Math.hypot(dx, dy) < EYE_DEADZONE_PX) return;
  // Dominant axis decides direction; magnitude doesn't matter beyond deadzone.
  let look: AnimationName;
  if (Math.abs(dx) > Math.abs(dy)) {
    look = dx > 0 ? 'LookRight' : 'LookLeft';
  } else {
    look = dy > 0 ? 'LookDown' : 'LookUp';
  }
  send(look);
}

// ── Drag detection ──────────────────────────────────────────────────────────
//
// Per-frame drag deltas come in via IPC.windowDrag. We accumulate them and
// fire the copter-hat idle (Idle3_2) once we've moved enough to know this is
// a real drag, not a misclick. The drag heartbeat in registerHandlers re-fires
// the same animation so it keeps playing for the duration of the drag.
// Idle3_2 is non-directional (Merlin's copter-hat appears, no L/R/U/D lean),
// so the visual is consistent regardless of which way the user is dragging.

let dragAccumDx = 0;
let dragAccumDy = 0;
let dragAnimStarted = false;
const DRAG_START_THRESHOLD_PX = 6;
// MoveUp is the copter-hat-glides-upward animation — the cleanest "Merlin is
// in transit" look across the four directional Move* sprites. We use it
// regardless of drag direction because clippyjs's directional Move* sprites
// don't read well when the actual motion is driven by the user's hand: the
// copter-hat alone signals "being carried" and the user's drag does the rest.
const DRAG_ANIMATION: AnimationName = 'MoveUp';

function resetDragAccum(): void {
  dragAccumDx = 0;
  dragAccumDy = 0;
}

function resetDragSession(): void {
  resetDragAccum();
  dragAnimStarted = false;
}

// ── Public API: USER-INITIATED REACTIONS ────────────────────────────────────

export function getIntent(): Intent {
  return intent;
}

// Playful pool for double-click — variety so it doesn't feel repetitive
// across repeated double-clicks. pickAnim biases away from the most recent
// few picks via the shared ring buffer, so back-to-back double-clicks
// actually look different.
const DOUBLE_CLICK_ANIMATIONS: readonly AnimationName[] = [
  'Pleased',
  'Wave',
  'Greet',
  'Surprised',
  'Acknowledge',
  'GestureRight',
  'GestureLeft',
  'Congratulate',
  'Congratulate_2',
  'DoMagic1',
  'DoMagic2',
  'GetAttention',
  'Alert',
];

/** Double-click. Picks a random fun gesture, then the caller usually opens */
/** the ask bubble/panel. */
export function reactToDoubleClick(): void {
  if (intent === 'hidden') return;
  touchInteraction();
  if (intent === 'sleeping') return; // wakeIfSleeping handles the gesture + return-to-idle
  setIntent('reacting', 'double-click');
  const pick = pickAnim(DOUBLE_CLICK_ANIMATIONS) ?? 'Pleased';
  send(pick, { important: true });
  scheduleReactionFinish(1800);
}

/** Right-click. Acknowledge (the tray menu will pop up anyway). */
export function reactToRightClick(): void {
  if (intent === 'hidden') return;
  touchInteraction();
  if (intent === 'sleeping') return;
  if (intent === 'idle' || intent === 'reacting') {
    setIntent('reacting', 'right-click');
    send('Acknowledge', { important: true });
    scheduleReactionFinish(1500);
  }
}

/** Start of a drag. Reset the throttle so the upcoming Move* fires without */
/** being dropped. We do NOT send a stop IPC here — empirically, calling */
/** clippyjs's agent.stop() immediately before agent.play() leaves it in a */
/** state where the new animation doesn't render. Better to let the previous */
/** animation finish naturally; the new Move* preempts via the */
/** PREEMPTING_ANIMATIONS path or just queues briefly. */
export function reactToDragStart(): void {
  if (intent === 'hidden') return;
  touchInteraction();
  if (intent === 'thinking' || intent === 'speaking' || intent === 'doing') return;
  resetDragSession();
  setIntent('reacting', 'drag-start');
  lastSendAt = 0; // reset send-throttle without sending a stop IPC
  // Drag can run arbitrarily long — the safety-net will still kick in if the
  // drag-end IPC is somehow missed (renderer crash mid-drag). The IPC layer
  // also has its own 6s safety timer for that case.
}

/** Per-frame drag delta. Fires the copter-hat idle (Idle3_2) on the very */
/** first detectable drag movement (~6px accumulated) so the animation begins */
/** AS THE USER STARTS DRAGGING, not after they let go. Subsequent ticks just */
/** accumulate deltas without re-firing — the drag heartbeat handles repeats */
/** if the user holds without moving. */
export function reactToDrag(dx: number, dy: number): void {
  if (intent === 'hidden') return;
  // Drags during chat lifecycle don't get a drag animation — Merlin's already
  // busy. The user is just repositioning him out of the way.
  if (intent === 'thinking' || intent === 'speaking' || intent === 'doing') return;
  dragAccumDx += dx;
  dragAccumDy += dy;
  if (dragAnimStarted) return;
  if (Math.hypot(dragAccumDx, dragAccumDy) < DRAG_START_THRESHOLD_PX) return;
  dragAnimStarted = true;
  send(DRAG_ANIMATION, { important: true });
}

/** Drag finished. Let any in-flight MoveUp continue playing — interrupting */
/** would discard the queued animation and the user would see nothing at */
/** all. Schedule a calm idle gesture ~1.5s after release so Merlin visibly */
/** returns to a resting pose once MoveUp has had time to play. */
export function reactToDragEnd(): void {
  if (intent === 'hidden') return;
  resetDragSession();
  if (intent === 'reacting') {
    setIntent('idle', 'drag-end');
    setTimeout(() => {
      if (intent !== 'idle') return;
      const idle = pickAnim(IDLE_ANIMATIONS);
      if (idle) send(idle);
    }, 1500);
  }
}

/** Heartbeat tick: re-fire the copter-hat idle while the user is still */
/** holding the sprite mid-drag (mouse held still). Without this, Idle3_2 */
/** plays once (~10s) and ends, leaving the sprite static during a long held */
/** drag. Skipped if the drag was too small to fire the initial animation. */
export function repeatLastDragAnim(): void {
  if (intent === 'hidden') return;
  if (!dragAnimStarted) return;
  if (intent === 'thinking' || intent === 'speaking' || intent === 'doing') return;
  send(DRAG_ANIMATION, { important: true });
}

/** Mouse wheel zoom — playful Surprised reaction. */
export function reactToZoom(): void {
  if (intent === 'hidden') return;
  touchInteraction();
  if (intent === 'sleeping') return;
  if (intent !== 'idle' && intent !== 'reacting') return;
  setIntent('reacting', 'zoom');
  // Throttled: rapid wheel ticks would otherwise queue up Surprised's.
  send('Surprised');
  scheduleReactionFinish(1500);
}

// ── Public API: CHAT LIFECYCLE ──────────────────────────────────────────────

export function chatStart(): void {
  clearSpeakingTimer();
  setIntent('thinking', 'chat-start');
  // Fire Think immediately, then cycle thinking/reading/processing variants
  // every 3-5.5s until the first reply chunk arrives (chatFirstReply will
  // transition us to 'speaking', which cancels the thinking cycle via
  // setIntent). For long LLM turns (especially tool-heavy Hermes flows)
  // this keeps the user from staring at a frozen Merlin for 30+ seconds.
  send('Think', { important: true });
  scheduleNextThinkingGesture();
}

export function chatFirstReply(): void {
  // Cut off any in-flight thinking gesture before we start speaking — no
  // point letting a Reading animation linger 5s into the actual reply.
  interruptCurrent();
  setIntent('speaking', 'first-reply');
  send('Explain', { important: true });
  scheduleNextSpeakingGesture();
}

export function chatEnd(): void {
  clearSpeakingTimer();
  if (intent === 'hidden') return;
  // Crisp end: clear the renderer-side animation queue + interrupt the
  // currently-playing gesture so a long speaking/thinking anim doesn't
  // overhang past the end of TTS audio. ClippyController.stop() handles
  // both via agent.stop + queue.clear, then sets up the natural idle
  // scheduler so Merlin doesn't freeze on a final frame.
  interruptCurrent();
  setIntent('idle', 'chat-end');
}

export function chatAborted(): void {
  clearSpeakingTimer();
  if (intent === 'hidden') return;
  interruptCurrent();
  setIntent('idle', 'chat-aborted');
}

// ── Public API: TOOL EXECUTION ──────────────────────────────────────────────

const TOOL_ANIMATION_MAP: Record<string, AnimationName> = {
  web_search: 'Searching',
  add_task: 'Write',
  complete_task: 'Write',
  remove_task: 'Write',
  list_tasks: 'Read',
  move_to: 'GestureRight',
  hide: 'Hide',
  show: 'Show',
};

export function toolStart(toolName: string): void {
  if (intent === 'hidden') return;
  const anim = TOOL_ANIMATION_MAP[toolName];
  if (!anim) return;
  send(anim, { important: true });
}

/** Tool finished — celebrate or commiserate based on success. */
export async function toolFinish(_toolName: string, ok: boolean): Promise<void> {
  if (intent === 'hidden') return;
  // Don't fire success/failure gestures during speaking — they'd preempt the
  // speaking cycle visibly. Tools usually finish before speaking starts; this
  // guard is for unusual orderings.
  if (intent === 'speaking') return;
  const pal = await palette();
  const pick = pickAnim(ok ? pal.success : pal.failure);
  if (pick) send(pick);
}

// ── Public API: CONTENT REACTIONS ───────────────────────────────────────────

/** Scan the user's input text for affective signals and queue a quick gesture. */
/** Called from interaction.ts when the user submits. */
export async function contentReaction(userText: string): Promise<void> {
  if (intent === 'hidden') return;
  const t = userText.toLowerCase().trim();
  if (!t) return;
  const pal = await palette();
  let pick: AnimationName | null = null;
  if (/\bthanks?\b|\bthank you\b|\bthx\b/.test(t)) {
    pick = pickAnim(pal.thank);
  } else if (/\bsorry\b|\bplease\b/.test(t)) {
    pick = pickAnim(pal.thank);
  } else if (t.length > 4 && (t.endsWith('!') || /\b(amazing|awesome|wow)\b/.test(t))) {
    pick = pickAnim(pal.surprise);
  } else if (t.endsWith('??') || t.endsWith('?!') ||
             /\b(what|why|how|huh)\b.*\?/.test(t) && t.length < 50) {
    pick = pickAnim(pal.confusion);
  }
  if (pick) send(pick);
}

// ── Public API: VISIBILITY / FOCUS ──────────────────────────────────────────

export async function setHidden(): Promise<void> {
  clearSpeakingTimer();
  setIntent('hidden', 'hide');
  await hideMerlinWithAnimation();
}

export async function setVisible(): Promise<void> {
  if (intent === 'hidden') setIntent('idle', 'show');
  await showMerlinWithAnimation();
}

/** App lost focus — Merlin glances away (subtle, not always). */
export function reactToAppBlur(): void {
  if (intent !== 'idle') return;
  // 40% chance, modulated by energy — sleepy Merlin doesn't bother.
  if (Math.random() > 0.4 * energyFactor()) return;
  setIntent('reacting', 'app-blur');
  send(Math.random() < 0.5 ? 'LookLeft' : 'LookRight');
  scheduleReactionFinish(1500);
}

/** App regained focus — perk up. */
export async function reactToAppFocus(): Promise<void> {
  if (intent === 'hidden') return;
  if (intent === 'sleeping') {
    void wakeIfSleeping();
    return;
  }
  if (intent !== 'idle' && intent !== 'reacting') return;
  // Only ~30% of focus events trigger a reaction — otherwise too distracting.
  if (Math.random() > 0.3) return;
  const pal = await palette();
  const pick = pickAnim(pal.fidget) ?? 'Acknowledge';
  setIntent('reacting', 'app-focus');
  send(pick);
  scheduleReactionFinish(1500);
}

// ── Brain idle thought ──────────────────────────────────────────────────────

export function nudgeForIdleThought(): void {
  if (intent !== 'idle') return;
  setIntent('reacting', 'idle-thought-nudge');
  void wiggleSprite();
  send('GetAttention', { important: true });
  scheduleReactionFinish(1800);
}

// ── LLM inline tag passthrough ──────────────────────────────────────────────

export function playInline(name: string): void {
  if (!isAnimationName(name)) return;
  if (name === 'Hide') { void setHidden(); return; }
  if (name === 'Show') { void setVisible(); return; }
  if (name === 'GetAttention') void wiggleSprite();
  // LLM-emitted tags are author intent — always fire.
  send(name, { important: true });
}

// ── Boot: start the proactive timers ────────────────────────────────────────

let booted = false;
export function startProactiveBehaviors(): void {
  if (booted) return;
  booted = true;
  scheduleNextEyeCheck();
  armSleepTimer();
  logger.info('AnimationController: proactive behaviors started');
}

// ── Debug + safety-net ──────────────────────────────────────────────────────

export function debugState(): string {
  return `intent=${intent} energy=${getEnergy()} ` +
    `sleep=${sleepTimer ? 'armed' : 'off'} ` +
    `eye=${eyeTimer ? 'armed' : 'off'} speaking=${speakingTimer ? 'on' : 'off'} ` +
    `recent=[${recentAnims.join(',')}]`;
}

let lastLoggedIntent: Intent = intent;
setInterval(() => {
  // Safety net: if intent has been 'reacting' for longer than the safety
  // window, force it back to idle. Catches stuck states from missed
  // setTimeouts, renderer crashes mid-reaction, or any reaction trigger
  // that forgot to call scheduleReactionFinish.
  if (
    intent === 'reacting' &&
    reactingStartedAt > 0 &&
    Date.now() - reactingStartedAt > REACTING_SAFETY_NET_MS
  ) {
    logger.warn(
      `AnimationController: safety-net forcing 'reacting' → 'idle' after ${REACTING_SAFETY_NET_MS}ms`,
    );
    setIntent('idle', 'safety-net');
  }
  if (lastLoggedIntent !== intent) {
    logger.debug('AnimationController:', debugState());
    lastLoggedIntent = intent;
  }
}, 1000);
