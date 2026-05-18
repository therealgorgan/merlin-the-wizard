import type { AnimationName } from '@shared/animations';
import {
  IDLE_ANIMATIONS,
  PREEMPTING_ANIMATIONS,
  SOFT_PREEMPTING_ANIMATIONS,
  isAnimationName,
} from '@shared/animations';

// Minimal shape of the clippyjs Agent we use. Anything else is `unknown`.
interface ClippyAgent {
  play(name: string, timeout?: number, cb?: () => void): void;
  stop(): void;
  show(fast?: boolean): void;
  hide(fast?: boolean, cb?: () => void): void;
  animations(): string[];
  hasAnimation(name: string): boolean;
  gestureAt(x: number, y: number): void;
}

// Loosely-typed view into clippyjs's internals so we can force-switch
// animations without going through its queue (which waits for the current
// animation to gracefully exit-branch first — fine for chat-paced flows,
// terrible for "play MoveUp NOW because the user just started dragging").
interface ClippyInternals {
  _animator?: {
    showAnimation: (name: string, cb: (animName: string, state: number) => void) => boolean;
    pause: () => void;
    resume: () => void;
  };
  _queue?: {
    clear: () => void;
    _active?: boolean;
  };
}

type Job =
  | { kind: 'play'; name: AnimationName; resolve: () => void }
  | { kind: 'stop'; resolve: () => void };

// Longer idles reduce audio/animation churn — the rapid back-to-back sound
// playbacks were stalling animation frames. 30-90s feels alive without spam.
const IDLE_MIN_MS = 30_000;
const IDLE_MAX_MS = 90_000;

export class ClippyController {
  private queue: Job[] = [];
  private running: Job | null = null;
  private idleTimer: number | null = null;
  private available: Set<string> = new Set();

  constructor(private agent: ClippyAgent) {
    for (const name of agent.animations()) {
      this.available.add(name);
    }
    this.agent.show(true);
    this.scheduleIdle();
  }

  enqueue(name: AnimationName): void {
    if (!isAnimationName(name)) return;
    if (!this.available.has(name)) {
      console.warn(`[ClippyController] Animation "${name}" unavailable in clippyjs Merlin pack`);
      return;
    }
    this.cancelIdle();
    if (PREEMPTING_ANIMATIONS.has(name)) {
      // Hard preempt — kill current sprite-frame animation immediately. Used
      // for Hide/Show/GetAttention where the user expects RIGHT NOW behavior.
      this.queue = [];
      this.agent.stop();
    } else if (SOFT_PREEMPTING_ANIMATIONS.has(name)) {
      // Soft preempt: clear pending queue. If something else is currently
      // running, force-switch directly via the animator (bypassing clippyjs's
      // internal queue, which would otherwise wait for the previous animation
      // to gracefully exit-branch before starting MoveUp — typically too slow
      // for "show MoveUp the moment the user begins dragging").
      this.queue = [];
      if (this.running) {
        if (this.running.kind === 'play' && this.running.name === name) {
          // Already running this exact animation (e.g. drag heartbeat
          // re-fired MoveUp while MoveUp is still playing) — don't restart
          // from frame 0; let it continue.
          return;
        }
        if (this.hardSwitchTo(name)) return;
        // Fall through to queue path if internals weren't accessible.
      }
    }
    this.queue.push({ kind: 'play', name, resolve: () => {} });
    this.pump();
  }

  /** Bypass clippyjs's queue and switch animator directly. Returns true if */
  /** the switch was applied; false if clippyjs internals weren't accessible */
  /** and the caller should fall back to the normal queue path. */
  private hardSwitchTo(name: AnimationName): boolean {
    const internals = this.agent as unknown as ClippyInternals;
    const animator = internals._animator;
    const internalQueue = internals._queue;
    if (!animator?.showAnimation) return false;

    // Free clippyjs's queue from the previously-running queue function (which
    // would otherwise stay "active" forever waiting for an exit-branch
    // callback we're about to skip past).
    if (internalQueue?.clear) internalQueue.clear();
    if (internalQueue) internalQueue._active = false;
    if (animator.pause) animator.pause();

    this.running = { kind: 'play', name, resolve: () => {} };
    animator.showAnimation(name, (_animName, _state) => {
      // Fires when the animator reaches the animation's last frame — for
      // animations with useExitBranching this is WAITING (state=1) not
      // EXITED (state=0). Treat either as "done" so we transition cleanly
      // back to the queue/idle scheduler.
      this.running = null;
      if (this.queue.length === 0) this.scheduleIdle();
      else this.pump();
    });
    if (animator.resume) animator.resume();
    return true;
  }

  stop(): void {
    this.queue = [];
    this.cancelIdle();
    this.agent.stop();
    this.running = null;
    this.scheduleIdle();
  }

  private pump(): void {
    if (this.running || this.queue.length === 0) return;
    const job = this.queue.shift()!;
    this.running = job;
    if (job.kind === 'play') {
      this.agent.play(job.name, 6000, () => {
        job.resolve();
        this.running = null;
        if (this.queue.length === 0) this.scheduleIdle();
        else this.pump();
      });
    }
  }

  private scheduleIdle(): void {
    this.cancelIdle();
    const ms = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      if (this.running || this.queue.length > 0) return;
      const pick = IDLE_ANIMATIONS[Math.floor(Math.random() * IDLE_ANIMATIONS.length)]!;
      if (!this.available.has(pick)) {
        this.scheduleIdle();
        return;
      }
      this.queue.push({ kind: 'play', name: pick, resolve: () => {} });
      this.pump();
    }, ms);
  }

  private cancelIdle(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
