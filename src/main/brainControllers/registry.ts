import type { BrainControllerFactory } from './types';
import { makeDefaultBrain } from './defaultBrain';
import { makeLocalLlmBrain } from './localLlmBrain';
import { makeHermesBrain } from './hermesBrain';

// Registry of brain controllers. v0.4.0 shipped only 'default'; v0.5.0
// adds 'local-llm' (Ollama-driven) and 'hermes' (Hermes Agent-driven).
// The interface in types.ts is locked — adding more controllers is just
// another entry here.

export const BRAIN_CONTROLLERS: Readonly<Record<string, BrainControllerFactory>> = {
  default: {
    id: 'default',
    displayName: 'Default (timer-based)',
    description:
      'The built-in autonomous loop. Ticks every 60s; emits idle thoughts ' +
      'and wanders the sprite when the user has been idle for >90s. No ' +
      'external dependencies — works offline.',
    create: () => makeDefaultBrain(),
  },
  'local-llm': {
    id: 'local-llm',
    displayName: 'Local LLM (Ollama)',
    description:
      'A local Ollama-hosted model decides what Merlin should do at each ' +
      'idle tick. Coarse cadence (5 min between ticks); falls back to no-op ' +
      'silently if Ollama is unreachable or slow. Requires Ollama installed ' +
      'and a model pulled — run the Setup Wizard to get started.',
    configSchema: [
      { key: 'endpoint', type: 'string', label: 'Ollama endpoint', default: 'http://localhost:11434/api' },
      { key: 'model', type: 'string', label: 'Model name (e.g. llama3.2:3b)', default: 'llama3.2:3b' },
      { key: 'temperature', type: 'number', label: 'Temperature', default: 0.8 },
    ],
    create: () => makeLocalLlmBrain(),
  },
  hermes: {
    id: 'hermes',
    displayName: 'Hermes Agent (self-hosted)',
    description:
      'A configured Hermes Agent profile decides what Merlin should do at ' +
      'each idle tick. Uses the OpenAI-compatible chat completions API. ' +
      'Requires endpoint + API key — run the Setup Wizard.',
    configSchema: [
      { key: 'endpoint', type: 'string', label: 'Hermes endpoint (e.g. http://host:8642/v1)', default: '' },
      { key: 'model', type: 'string', label: 'Profile / model name', default: 'hermes-agent' },
      { key: 'temperature', type: 'number', label: 'Temperature', default: 0.7 },
    ],
    create: () => makeHermesBrain(),
  },
};

export function getBrainFactory(id: string): BrainControllerFactory | undefined {
  return BRAIN_CONTROLLERS[id];
}
