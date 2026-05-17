import type { AnimationName } from './animations';

export type ProviderId = 'anthropic' | 'openai' | 'ollama';

export type Personality = 'balanced' | 'medieval' | 'competence';

export type PTTMode = 'hold' | 'toggle' | 'button';

export type TTSEngineId = 'edge' | 'sapi' | 'off';

export interface Settings {
  provider: ProviderId;
  model: Partial<Record<ProviderId, string>>;
  personality: Personality;
  ptt: PTTMode;
  tts: TTSEngineId;
  ttsVoice: string;
  summonHotkey: string;
  pttHotkey: string;
  advanced: {
    computerUse: boolean;
    showDebugPanel: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'anthropic',
  model: {
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4.1',
    ollama: 'llama3.1',
  },
  personality: 'balanced',
  ptt: 'toggle',
  tts: 'edge',
  ttsVoice: 'en-US-GuyNeural',
  summonHotkey: 'Control+Shift+M',
  pttHotkey: 'Control+Space',
  advanced: {
    computerUse: false,
    showDebugPanel: false,
  },
};

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface ToolCallRequest {
  callId: string;
  tool: string;
  input: unknown;
  reason: string;
}

export interface ToolCallResponse {
  approved: boolean;
  note?: string;
}

export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'anim'; name: AnimationName }
  | { type: 'tool-call'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; result: unknown }
  | { type: 'error'; message: string }
  | { type: 'done' };
