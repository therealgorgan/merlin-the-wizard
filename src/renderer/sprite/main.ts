import jquery from 'jquery';
import type { AnimationName } from '@shared/animations';
import { ClippyController } from './ClippyController';

// clippyjs is UMD code that expects a global `jQuery` and `$`.
(window as unknown as { jQuery: typeof jquery; $: typeof jquery }).jQuery = jquery;
(window as unknown as { $: typeof jquery }).$ = jquery;

interface ClippyModule {
  load: (
    name: string,
    onSuccess: (agent: unknown) => void,
    onFail?: (err: unknown) => void,
    basePath?: string,
  ) => void;
}

const LOCAL_BASE = '../agents/';

let controller: ClippyController | null = null;
let currentAgent: { hide?: (fast?: boolean) => void } | null = null;
let currentCharacter = 'Merlin';

async function loadClippy(): Promise<ClippyModule> {
  const mod = await import('clippyjs');
  const m = mod as unknown as ClippyModule & { default?: ClippyModule };
  return m.default ?? m;
}

function applyZoom(zoom: number): void {
  document.documentElement.style.setProperty('--merlin-zoom', String(zoom));
}

function applyAppearance(appearance: 'classic' | 'retouched'): void {
  document.body.dataset.appearance = appearance;
}

let mediaMuted = false;
const origMediaPlay = HTMLMediaElement.prototype.play;
type MaybeVoice = HTMLMediaElement & { __merlinVoice?: boolean };
HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
  if (mediaMuted && !(this as MaybeVoice).__merlinVoice) {
    return Promise.resolve();
  }
  return origMediaPlay.call(this);
};

function applyMute(muted: boolean): void {
  mediaMuted = muted;
  if (muted) {
    document.querySelectorAll('audio').forEach((a) => {
      try {
        a.pause();
        a.currentTime = 0;
      } catch {
        /* ignore */
      }
    });
  }
}

interface SpriteEventsApi {
  doubleClick(): void;
  rightClick(x: number, y: number): void;
  drag(dx: number, dy: number): void;
  dragEnd(): void;
  zoomBy(delta: number): void;
}
declare global {
  interface Window {
    spriteEvents?: SpriteEventsApi;
  }
}

const DRAG_THRESHOLD_PX = 3;
// Coalesce pointermove deltas into rAF-batched IPC sends. Per-frame setPosition
// in main blocks the renderer's paint pipeline; batching at 60Hz gives clippyjs
// breathing room to actually render its sprite-frame animation during the drag.
let pendingDragDx = 0;
let pendingDragDy = 0;
let dragLoopRunning = false;

// Smoothed horizontal velocity → CSS --merlin-drag-tilt (pendulum sway).
// Pure CSS-var update so it's compositor-friendly. Decays back to 0 when the
// user holds the mouse still mid-drag so Merlin settles upright.
let smoothedDx = 0;
const SWAY_SMOOTH_ALPHA = 0.35;
const SWAY_DECAY_PER_FRAME = 0.86;
const SWAY_X_TILT_FACTOR = -0.55;
const SWAY_MAX_TILT_DEG = 14;

function applySway(): void {
  const tilt = Math.max(
    -SWAY_MAX_TILT_DEG,
    Math.min(SWAY_MAX_TILT_DEG, smoothedDx * SWAY_X_TILT_FACTOR),
  );
  document.documentElement.style.setProperty('--merlin-drag-tilt', `${tilt.toFixed(2)}deg`);
}

function dragLoop(): void {
  if (!dragLoopRunning) return;
  if (pendingDragDx !== 0 || pendingDragDy !== 0) {
    const dx = pendingDragDx;
    const dy = pendingDragDy;
    pendingDragDx = 0;
    pendingDragDy = 0;
    smoothedDx = smoothedDx * (1 - SWAY_SMOOTH_ALPHA) + dx * SWAY_SMOOTH_ALPHA;
    window.spriteEvents?.drag(dx, dy);
  } else {
    smoothedDx *= SWAY_DECAY_PER_FRAME;
    if (Math.abs(smoothedDx) < 0.05) smoothedDx = 0;
  }
  applySway();
  requestAnimationFrame(dragLoop);
}

function startDragLoop(): void {
  if (dragLoopRunning) return;
  dragLoopRunning = true;
  requestAnimationFrame(dragLoop);
}

function stopDragLoop(): void {
  dragLoopRunning = false;
  smoothedDx = 0;
  document.documentElement.style.removeProperty('--merlin-drag-tilt');
}

function flushPendingDrag(): void {
  if (pendingDragDx === 0 && pendingDragDy === 0) return;
  const dx = pendingDragDx;
  const dy = pendingDragDy;
  pendingDragDx = 0;
  pendingDragDy = 0;
  window.spriteEvents?.drag(dx, dy);
}

function wireMouseEvents(): void {
  let active: { lastX: number; lastY: number; pointerId: number; moved: boolean } | null = null;
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    active = { lastX: e.screenX, lastY: e.screenY, pointerId: e.pointerId, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  });
  document.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== active.pointerId) return;
    const dx = e.screenX - active.lastX;
    const dy = e.screenY - active.lastY;
    if (!active.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
      active.moved = true;
      document.body.classList.add('merlin-dragging');
      startDragLoop();
    }
    if (active.moved && (dx || dy)) {
      active.lastX = e.screenX;
      active.lastY = e.screenY;
      pendingDragDx += dx;
      pendingDragDy += dy;
    }
  });
  function endDrag(e: PointerEvent): void {
    if (!active || e.pointerId !== active.pointerId) return;
    const wasMoved = active.moved;
    (e.target as Element).releasePointerCapture?.(active.pointerId);
    active = null;
    document.body.classList.remove('merlin-dragging');
    // Flush any pending coalesced delta so the final position is exact.
    flushPendingDrag();
    stopDragLoop();
    // Tell main the drag explicitly ended — main otherwise infers end from
    // "no drag deltas for 220ms" which incorrectly fires when the user holds
    // the mouse button without moving. Only fire if we actually dragged
    // (not for a quick click that didn't cross the drag threshold).
    if (wasMoved) window.spriteEvents?.dragEnd();
  }
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  document.addEventListener('dblclick', (e) => {
    e.preventDefault();
    window.spriteEvents?.doubleClick();
  });
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.spriteEvents?.rightClick(e.screenX, e.screenY);
  });

  let lastWheelAt = 0;
  const WHEEL_COOLDOWN_MS = 60;
  document.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const now = performance.now();
      if (now - lastWheelAt < WHEEL_COOLDOWN_MS) return;
      lastWheelAt = now;
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      window.spriteEvents?.zoomBy(delta);
    },
    { passive: false },
  );
}

async function mountCharacter(clippy: ClippyModule, name: string): Promise<void> {
  // Tear down existing agent so we don't pile up DOM nodes / audio.
  if (currentAgent) {
    try {
      currentAgent.hide?.(true);
    } catch {
      /* ignore */
    }
    document.querySelectorAll('body > .clippy, body > .clippy-balloon').forEach((el) => el.remove());
    currentAgent = null;
    controller?.stop();
    controller = null;
  }
  currentCharacter = name;
  return new Promise<void>((resolve) => {
    clippy.load(
      name,
      (agent) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = agent as any;
        currentAgent = a;
        controller = new ClippyController(a);
        console.log('[merlin-sprite] loaded character:', name);
        resolve();
      },
      (err) => {
        console.error('[merlin-sprite] failed to load', name, err);
        resolve();
      },
      LOCAL_BASE,
    );
  });
}

void (async () => {
  let clippy: ClippyModule;
  try {
    clippy = await loadClippy();
  } catch (err) {
    console.error('[merlin-sprite] failed to import clippyjs', err);
    return;
  }
  const api = window.spriteApi;
  if (!api) {
    console.warn('[merlin-sprite] spriteApi not exposed by preload');
    return;
  }

  // Pull initial state from main now that we exist. This avoids the race where
  // main pushed initial settings before our handlers were wired.
  let initialCharacter = 'Merlin';
  try {
    const initial = await api.getInitial();
    applyZoom(initial.zoom);
    applyMute(initial.muteSounds);
    applyAppearance(initial.appearance || 'classic');
    initialCharacter = initial.character || 'Merlin';
  } catch (err) {
    console.warn('[merlin-sprite] getInitial failed, using defaults', err);
  }
  await mountCharacter(clippy, initialCharacter);

  api.onPlay((name: AnimationName) => controller?.enqueue(name));
  api.onStop(() => controller?.stop());
  api.onShow(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (currentAgent as any)?.show?.(false);
  });
  api.onHide(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (currentAgent as any)?.hide?.(false);
  });
  api.onSetZoom(applyZoom);
  api.onSetMuteSounds(applyMute);
  api.onSetCharacter((id: string) => {
    if (id === currentCharacter) return;
    void mountCharacter(clippy, id);
  });
  api.onSetAppearance(applyAppearance);

  // TTS voice playback queue (unchanged from before).
  const voiceQueue: HTMLAudioElement[] = [];
  let voicePlaying: HTMLAudioElement | null = null;
  function playNextVoice(): void {
    if (voicePlaying || voiceQueue.length === 0) return;
    voicePlaying = voiceQueue.shift() ?? null;
    if (!voicePlaying) return;
    voicePlaying.addEventListener('ended', () => {
      voicePlaying = null;
      playNextVoice();
    });
    voicePlaying.addEventListener('error', () => {
      console.warn('[merlin-voice] audio element error event');
      voicePlaying = null;
      playNextVoice();
    });
    origMediaPlay
      .call(voicePlaying)
      .then(() => {
        console.log(
          '[merlin-voice] play() resolved. paused=',
          voicePlaying?.paused,
          'muted=',
          voicePlaying?.muted,
          'vol=',
          voicePlaying?.volume,
        );
      })
      .catch((err: Error) => {
        console.warn('[merlin-voice] play() rejected:', err?.name, err?.message);
      });
  }
  api.onPlayAudio((dataUrl: string) => {
    console.log('[merlin-voice] received audio data URL,', dataUrl.length, 'chars');
    const audio = new Audio(dataUrl);
    (audio as MaybeVoice).__merlinVoice = true;
    audio.volume = 1.0;
    audio.muted = false;
    voiceQueue.push(audio);
    playNextVoice();
  });
  api.onStopAudio(() => {
    voiceQueue.length = 0;
    if (voicePlaying) {
      try {
        voicePlaying.pause();
      } catch {
        /* ignore */
      }
      voicePlaying = null;
    }
  });

  wireMouseEvents();
})();
