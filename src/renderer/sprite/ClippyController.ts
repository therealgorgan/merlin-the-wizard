import type { AnimationName } from '@shared/animations';
import { IDLE_ANIMATIONS, PREEMPTING_ANIMATIONS, isAnimationName } from '@shared/animations';

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
      this.queue = [];
      this.agent.stop();
    }
    this.queue.push({ kind: 'play', name, resolve: () => {} });
    this.pump();
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
