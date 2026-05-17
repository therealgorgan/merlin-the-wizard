import { screen } from 'electron';
import { IPC } from '@shared/ipc-contract';
import { isAnimationName, type AnimationName } from '@shared/animations';
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

function decayEnergy(): void {
  const now = Date.now();
  const minutes = (now - lastEnergyUpdate) / 60_000;
  lastEnergyUpdate = now;
  if (minutes <= 0) return;
  // Base decay: 1 energy per minute idle.
  let drain = minutes;
  // Late night (22:00–6:00) drains 2x faster.
  const tod = timeOfDay();
  if (tod === 'night') drain *= 2;
  // While actually sleeping, restore (Merlin "rests up").
  if (intent === 'sleeping' && sleepStartedAt > 0) {
    const sleptMinutes = (now - sleepStartedAt) / 60_000;
    if (sleptMinutes > 5) {
      // Long sleep restores energy toward a comfortable level.
      energy = Math.max(energy, Math.min(80, 50 + sleptMinutes * 2));
    }
    return; // don't drain while sleeping
  }
  energy = Math.max(0, energy - drain);
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

const PALETTES: Record<Mood, MoodPalette> = {
  cheerful: {
    fidget: ['Pleased', 'Acknowledge', 'Wave', 'Surprised'],
    speaking: ['Hearing_1', 'Hearing_2', 'Explain', 'Pleased'],
    wake: ['Greet', 'Wave', 'Pleased'],
    success: ['DoMagic1', 'Pleased', 'Congratulate'],
    failure: ['Confused', 'Uncertain'],
    thank: ['Pleased', 'Congratulate', 'Acknowledge'],
    surprise: ['Surprised', 'Alert'],
    confusion: ['Confused', 'Uncertain'],
  },
  thoughtful: {
    fidget: ['LookLeft', 'LookRight', 'Acknowledge', 'Idle1_1'],
    speaking: ['Hearing_3', 'Hearing_4', 'Explain', 'Process'],
    wake: ['Acknowledge', 'Explain'],
    success: ['Acknowledge', 'DoMagic2', 'Pleased'],
    failure: ['Confused', 'LookDown'],
    thank: ['Acknowledge', 'Pleased'],
    surprise: ['Surprised', 'LookUp'],
    confusion: ['Think', 'Uncertain'],
  },
  mischievous: {
    fidget: ['GestureLeft', 'GestureRight', 'Surprised', 'Wave'],
    speaking: ['Hearing_2', 'Hearing_4', 'GestureLeft', 'GestureRight'],
    wake: ['Surprised', 'Wave', 'GetAttention'],
    success: ['DoMagic1', 'DoMagic2', 'Congratulate_2'],
    failure: ['Confused', 'Surprised'],
    thank: ['Pleased', 'Wave'],
    surprise: ['Surprised', 'Alert', 'GetAttention'],
    confusion: ['Confused', 'Surprised'],
  },
  puzzled: {
    fidget: ['Confused', 'Uncertain', 'LookLeft', 'LookRight'],
    speaking: ['Hearing_1', 'Hearing_2', 'Explain', 'Uncertain'],
    wake: ['Confused', 'Acknowledge'],
    success: ['Pleased', 'Acknowledge'],
    failure: ['Confused', 'DontRecognize', 'Sad'],
    thank: ['Acknowledge'],
    surprise: ['Surprised', 'Confused'],
    confusion: ['Confused', 'DontRecognize', 'Uncertain'],
  },
  sad: {
    fidget: ['Sad', 'LookDown', 'Acknowledge', 'Idle1_1'],
    speaking: ['Hearing_3', 'Hearing_4', 'Sad', 'LookDown'],
    wake: ['Acknowledge', 'Sad'],
    success: ['Acknowledge', 'Pleased'],
    failure: ['Sad', 'LookDown'],
    thank: ['Acknowledge'],
    surprise: ['Surprised'],
    confusion: ['Confused', 'Sad'],
  },
  sleepy: {
    fidget: ['LookDownBlink', 'RestPose', 'Idle1_1', 'Idle2_1'],
    speaking: ['Hearing_1', 'Hearing_3', 'RestPose'],
    wake: ['LookUp', 'Acknowledge'],
    success: ['Pleased', 'Acknowledge'],
    failure: ['Confused', 'RestPose'],
    thank: ['Acknowledge', 'Pleased'],
    surprise: ['Surprised', 'LookUp'],
    confusion: ['Confused', 'Uncertain'],
  },
  curious: {
    fidget: ['LookLeft', 'LookRight', 'LookUp', 'Search'],
    speaking: ['Hearing_2', 'Hearing_4', 'Search', 'Reading'],
    wake: ['LookUp', 'Greet', 'Surprised'],
    success: ['Pleased', 'DoMagic1'],
    failure: ['Confused', 'LookDown'],
    thank: ['Pleased', 'Acknowledge'],
    surprise: ['Surprised', 'Alert', 'LookUp'],
    confusion: ['Confused', 'Search'],
  },
  pleased: {
    fidget: ['Pleased', 'Acknowledge', 'Wave', 'Congratulate'],
    speaking: ['Hearing_1', 'Hearing_2', 'Explain', 'Pleased'],
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
  // Time-of-day override: at night and at low energy, even cheerful Merlin
  // tilts toward the sleepy palette. The "true" mood still wins overall, but
  // calmer animations get added to each candidate set so the random pick
  // skews quieter.
  let base = PALETTES[m] ?? PALETTES.cheerful;
  const tod = timeOfDay();
  const lowEnergy = energy < 30;
  if (tod === 'night' || lowEnergy) {
    const sleepy = PALETTES.sleepy;
    base = {
      fidget: [...base.fidget, ...sleepy.fidget],
      speaking: [...base.speaking, ...sleepy.speaking],
      wake: base.wake, // wake should still pop
      success: base.success,
      failure: base.failure,
      thank: base.thank,
      surprise: base.surprise,
      confusion: base.confusion,
    };
  } else if (tod === 'morning' && energy > 70) {
    // High-energy mornings: tilt toward the cheerful palette for extra pep.
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
    intent = 'sleeping';
    sleepStartedAt = Date.now();
    send('RestPose', { important: true });
  }, SLEEP_AFTER_MS);
}

/** Wake Merlin if asleep — fired on any deliberate user input. */
async function wakeIfSleeping(): Promise<void> {
  if (intent !== 'sleeping') return;
  decayEnergy();
  sleepStartedAt = 0;
  gainEnergy(10);
  logger.debug('AnimationController: waking from sleep (energy=', getEnergy(), ')');
  intent = 'reacting';
  const pal = await palette();
  const pick = pickAnim(pal.wake) ?? 'Greet';
  send(pick, { important: true });
  setTimeout(() => {
    if (intent === 'reacting') {
      intent = 'idle';
      armSleepTimer();
      scheduleNextEyeCheck();
    }
  }, 1500);
}

// Mark any reactive event as "interaction happened" — resets sleep timer,
// credits a bit of energy, and wakes from sleep if needed.
function touchInteraction(): void {
  clearSleepTimer();
  gainEnergy(5);
  if (intent === 'sleeping') {
    void wakeIfSleeping();
    return;
  }
  if (intent === 'idle') armSleepTimer();
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

// ── Drag-direction detection ─────────────────────────────────────────────────
//
// Per-frame drag deltas come in via IPC.windowDrag. We accumulate them and
// fire a directional Move* animation when the user has dragged "enough"
// in some direction, with cooldown so we don't spam.

let dragAccumDx = 0;
let dragAccumDy = 0;
let dragLastDirection: 'L' | 'R' | 'U' | 'D' | null = null;
let dragLastAnimAt = 0;
const DRAG_DIRECTION_THRESHOLD_PX = 80;
// A Merlin Move* animation is ~2-3s. Don't queue another one within that
// window even on direction change — otherwise a brief zigzag fills the queue
// and Merlin keeps playing Move* for 10+ seconds after the drag ends.
const DRAG_MIN_GAP_MS = 2500;

function resetDragAccum(): void {
  dragAccumDx = 0;
  dragAccumDy = 0;
}

function resetDragSession(): void {
  resetDragAccum();
  dragLastDirection = null;
  dragLastAnimAt = 0;
}

// ── Public API: USER-INITIATED REACTIONS ────────────────────────────────────

export function getIntent(): Intent {
  return intent;
}

/** Double-click. Pleased fidget, then ask bubble opens via caller. */
export function reactToDoubleClick(): void {
  if (intent === 'hidden') return;
  touchInteraction();
  if (intent === 'sleeping') return; // wakeIfSleeping handles the gesture
  intent = 'reacting';
  send('Pleased', { important: true });
}

/** Right-click. Acknowledge (the tray menu will pop up anyway). */
export function reactToRightClick(): void {
  if (intent === 'hidden') return;
  touchInteraction();
  if (intent === 'sleeping') return;
  if (intent === 'idle' || intent === 'reacting') {
    intent = 'reacting';
    send('Acknowledge', { important: true });
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
  intent = 'reacting';
  lastSendAt = 0; // reset send-throttle without sending a stop IPC
}

/** Per-frame drag delta. Fires a Move* animation as soon as the drag has a */
/** detectable direction (~12px on first fire of a session, ~80px for */
/** subsequent direction changes within the same drag) so the animation */
/** begins AS THE USER STARTS DRAGGING, not after they let go. Repeat-fires */
/** are gated by direction change + a 2.5s minimum gap so the queue doesn't */
/** pile up. */
export function reactToDrag(dx: number, dy: number): void {
  if (intent === 'hidden') return;
  // Drags during chat lifecycle don't get directional animations — Merlin's
  // already busy. The user is just repositioning him out of the way.
  if (intent === 'thinking' || intent === 'speaking' || intent === 'doing') return;
  dragAccumDx += dx;
  dragAccumDy += dy;

  // First Move* of this drag session uses a tiny threshold (just enough to
  // pick a direction without being noise) so the animation starts on the
  // first or second drag delta. Subsequent direction changes need the larger
  // threshold so tiny wobbles don't switch animations mid-drag.
  const isFirstFire = dragLastDirection === null;
  const threshold = isFirstFire ? 6 : DRAG_DIRECTION_THRESHOLD_PX;
  const mag = Math.hypot(dragAccumDx, dragAccumDy);
  if (mag < threshold) return;

  // clippyjs Move* animations are inverted relative to drag direction —
  // dragging Merlin RIGHT means he's being pulled to the right, and the
  // matching gesture is "MoveLeft" (the trail-behind / lean-back look).
  let dir: 'L' | 'R' | 'U' | 'D';
  if (Math.abs(dragAccumDx) > Math.abs(dragAccumDy)) {
    dir = dragAccumDx > 0 ? 'L' : 'R';
  } else {
    dir = dragAccumDy > 0 ? 'U' : 'D';
  }
  resetDragAccum();

  // Same direction as we just fired? Don't queue another one — the current
  // animation is still playing.
  if (dir === dragLastDirection) return;

  // Backstop: never queue Move* faster than the animation can play.
  const now = Date.now();
  if (now - dragLastAnimAt < DRAG_MIN_GAP_MS) return;
  dragLastDirection = dir;
  dragLastAnimAt = now;

  const move: AnimationName = (
    dir === 'L' ? 'MoveLeft'
    : dir === 'R' ? 'MoveRight'
    : dir === 'U' ? 'MoveUp'
    : 'MoveDown'
  );
  send(move, { important: true });
}

/** Drag finished. Cut off the in-flight Move* so Merlin returns to a clean */
/** idle state immediately — otherwise the last-queued Move* keeps playing for */
/** another 2-3s after the user has let go. */
export function reactToDragEnd(): void {
  if (intent === 'hidden') return;
  resetDragSession();
  if (intent === 'reacting') {
    intent = 'idle';
    interruptCurrent();
    armSleepTimer();
    // ClippyController's natural idle scheduler will pick the next animation
    // ~30-90s from now (or sooner on an eye-tracking tick).
  }
}

/** Mouse wheel zoom — playful Surprised reaction. */
export function reactToZoom(): void {
  if (intent === 'hidden') return;
  touchInteraction();
  if (intent === 'sleeping') return;
  if (intent !== 'idle' && intent !== 'reacting') return;
  intent = 'reacting';
  // Throttled: rapid wheel ticks would otherwise queue up Surprised's.
  send('Surprised');
}

// ── Public API: CHAT LIFECYCLE ──────────────────────────────────────────────

export function chatStart(): void {
  clearSpeakingTimer();
  clearSleepTimer();
  intent = 'thinking';
  send('Think', { important: true });
}

export function chatFirstReply(): void {
  intent = 'speaking';
  send('Explain', { important: true });
  scheduleNextSpeakingGesture();
}

export function chatEnd(): void {
  clearSpeakingTimer();
  if (intent === 'hidden') return;
  intent = 'idle';
  armSleepTimer();
}

export function chatAborted(): void {
  clearSpeakingTimer();
  if (intent === 'hidden') return;
  intent = 'idle';
  armSleepTimer();
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
  clearSleepTimer();
  clearEyeTimer();
  intent = 'hidden';
  await hideMerlinWithAnimation();
}

export async function setVisible(): Promise<void> {
  if (intent === 'hidden') intent = 'idle';
  await showMerlinWithAnimation();
  scheduleNextEyeCheck();
  armSleepTimer();
}

/** App lost focus — Merlin glances away (subtle, not always). */
export function reactToAppBlur(): void {
  if (intent !== 'idle') return;
  // 40% chance, modulated by energy — sleepy Merlin doesn't bother.
  if (Math.random() > 0.4 * energyFactor()) return;
  intent = 'reacting';
  send(Math.random() < 0.5 ? 'LookLeft' : 'LookRight');
  setTimeout(() => { if (intent === 'reacting') intent = 'idle'; }, 1500);
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
  intent = 'reacting';
  send(pick);
  setTimeout(() => { if (intent === 'reacting') intent = 'idle'; }, 1500);
}

// ── Brain idle thought ──────────────────────────────────────────────────────

export function nudgeForIdleThought(): void {
  if (intent !== 'idle') return;
  intent = 'reacting';
  void wiggleSprite();
  send('GetAttention', { important: true });
  setTimeout(() => {
    if (intent === 'reacting') {
      intent = 'idle';
      armSleepTimer();
    }
  }, 1500);
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

// ── Debug ───────────────────────────────────────────────────────────────────

export function debugState(): string {
  return `intent=${intent} sleep=${sleepTimer ? 'armed' : 'off'} ` +
    `eye=${eyeTimer ? 'armed' : 'off'} speaking=${speakingTimer ? 'on' : 'off'} ` +
    `recent=[${recentAnims.join(',')}]`;
}

let lastLoggedIntent: Intent = intent;
setInterval(() => {
  if (lastLoggedIntent !== intent) {
    logger.debug('AnimationController:', debugState());
    lastLoggedIntent = intent;
  }
}, 1000);
