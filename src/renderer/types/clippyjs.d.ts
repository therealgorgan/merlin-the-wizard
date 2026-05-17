declare module 'clippyjs' {
  export interface Agent {
    play(name: string, timeout?: number, cb?: () => void): void;
    stop(): void;
    show(fast?: boolean): void;
    hide(fast?: boolean, cb?: () => void): void;
    animations(): string[];
    hasAnimation(name: string): boolean;
    gestureAt(x: number, y: number): void;
  }
  export function load(
    name: string,
    onSuccess: (agent: Agent) => void,
    onFail?: (err: unknown) => void,
    basePath?: string,
  ): void;
  const _default: { load: typeof load };
  export default _default;
}
