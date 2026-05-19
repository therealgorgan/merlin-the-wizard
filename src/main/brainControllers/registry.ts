import type { BrainControllerFactory } from './types';
import { makeDefaultBrain } from './defaultBrain';

// Registry of brain controllers. v0.4.0 ships only 'default'; v0.5.0 adds
// 'local-llm' (Ollama-driven) and 'hermes' (Hermes Agent-driven). The
// interface stays stable across versions so the only thing 0.5.0 needs to
// do is register additional factories here.

export const BRAIN_CONTROLLERS: Readonly<Record<string, BrainControllerFactory>> = {
  default: {
    id: 'default',
    displayName: 'Default (timer-based)',
    description:
      'The built-in autonomous loop. Ticks every 60s; emits idle thoughts ' +
      'and wanders the sprite when the user has been idle for >90s.',
    create: () => makeDefaultBrain(),
  },
};

export function getBrainFactory(id: string): BrainControllerFactory | undefined {
  return BRAIN_CONTROLLERS[id];
}
