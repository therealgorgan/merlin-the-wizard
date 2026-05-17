import { createGroq } from '@ai-sdk/groq';
import { createOpenAI } from '@ai-sdk/openai';
import { createOllama } from 'ollama-ai-provider';
import { streamText, type CoreMessage, type LanguageModelV1 } from 'ai';
import { buildSystemPrompt, type PromptContext } from './systemPrompt';
import { merlinTools } from './tools';
import { read as readStore } from '../storage/store';
import { getMood } from '../feelings';
import { getSecret } from '../storage/secrets';
import { logger } from '../logger';

export type ProviderId = 'groq' | 'openrouter' | 'ollama' | 'minimax' | 'hermes';

export interface ProviderInfo {
  id: ProviderId;
  displayName: string;
  /** Short descriptor surfaced in the tray status row */
  shortLabel: string;
  /** Suggested models user can choose from (free-text input allowed). */
  suggestedModels: string[];
  defaultModel: string;
  /** True if a per-user API key is required. Ollama is local-only, no key. */
  needsApiKey: boolean;
  /** Optional secret name when needsApiKey is true. */
  secretName?: string;
  /** Where to get a key (linked from settings UI). */
  keyHelpUrl?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  groq: {
    id: 'groq',
    displayName: 'Groq',
    shortLabel: 'Groq',
    suggestedModels: [
      'llama-3.3-70b-versatile',
      'llama-3.1-70b-versatile',
      'qwen-2.5-72b-instruct',
      'openai/gpt-oss-120b',
    ],
    defaultModel: 'llama-3.3-70b-versatile',
    needsApiKey: true,
    secretName: 'groq_api_key',
    keyHelpUrl: 'https://console.groq.com/keys',
  },
  openrouter: {
    id: 'openrouter',
    displayName: 'OpenRouter',
    shortLabel: 'OpenRouter',
    suggestedModels: [
      'anthropic/claude-sonnet-4.6',
      'anthropic/claude-opus-4.7',
      'openai/gpt-5',
      'meta-llama/llama-3.3-70b-instruct',
      'google/gemini-2.5-pro',
      'mistralai/mistral-large-2411',
    ],
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    needsApiKey: true,
    secretName: 'openrouter_api_key',
    keyHelpUrl: 'https://openrouter.ai/keys',
  },
  ollama: {
    id: 'ollama',
    displayName: 'Ollama (local)',
    shortLabel: 'Ollama',
    suggestedModels: ['llama3.3', 'qwen2.5', 'mistral', 'phi3', 'codellama'],
    defaultModel: 'llama3.3',
    needsApiKey: false,
  },
  minimax: {
    id: 'minimax',
    displayName: 'MiniMax',
    shortLabel: 'MiniMax',
    suggestedModels: [
      'MiniMax-M2.7',
      'MiniMax-M2',
      'MiniMax-M1',
      'abab6.5s-chat',
      'MiniMax-Text-01',
    ],
    defaultModel: 'MiniMax-M2.7',
    needsApiKey: true,
    secretName: 'minimax_api_key',
    keyHelpUrl:
      'https://platform.minimax.io/user-center/basic-information/interface-key',
  },
  hermes: {
    id: 'hermes',
    displayName: 'Hermes Agent (self-hosted)',
    shortLabel: 'Hermes',
    // Hermes profiles each show up as a "model" via /v1/models. These are the
    // common ones from the Hermes Agent template profiles; users will see
    // their actual profile list after clicking "Discover ALL profiles" in
    // Settings (which probes ports 8640–8670 on the configured host).
    suggestedModels: [
      'hermes-agent', 'assistant', 'sonnet', 'research',
      'coach', 'expert',
    ],
    defaultModel: 'hermes-agent',
    needsApiKey: true,
    secretName: 'hermes_api_key',
  },
};

export function isProviderId(s: string): s is ProviderId {
  return s in PROVIDERS;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamChatOpts {
  history: ChatTurn[];
  signal?: AbortSignal;
  /** Optional image data URL to attach to the most recent user message. */
  /** Multimodal models will see the image; text-only models ignore it. */
  attachImageDataUrl?: string;
}

async function getEffectiveApiKey(info: ProviderInfo): Promise<string | null> {
  if (!info.needsApiKey || !info.secretName) return null;
  // Secret store first, .env fallback for groq specifically.
  const stored = await getSecret(info.secretName);
  if (stored) return stored;
  if (info.id === 'groq' && process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  return null;
}

async function buildModel(): Promise<{
  model: LanguageModelV1;
  providerId: ProviderId;
  modelName: string;
}> {
  const settings = await readStore();
  const rawId = settings.llmProvider ?? 'groq';
  const providerId: ProviderId = isProviderId(rawId) ? rawId : 'groq';
  const info = PROVIDERS[providerId];
  const modelName =
    typeof settings.llmModel === 'string' && settings.llmModel.trim()
      ? settings.llmModel
      : info.defaultModel;

  switch (providerId) {
    case 'groq': {
      const key = await getEffectiveApiKey(info);
      if (!key) throw new Error('Groq API key not configured');
      return { model: createGroq({ apiKey: key })(modelName), providerId, modelName };
    }
    case 'openrouter': {
      const key = await getEffectiveApiKey(info);
      if (!key) throw new Error('OpenRouter API key not configured');
      const client = createOpenAI({
        apiKey: key,
        baseURL: 'https://openrouter.ai/api/v1',
      });
      return { model: client(modelName), providerId, modelName };
    }
    case 'minimax': {
      const key = await getEffectiveApiKey(info);
      if (!key) throw new Error('MiniMax API key not configured');
      const client = createOpenAI({
        apiKey: key,
        baseURL: 'https://api.minimaxi.com/v1',
      });
      return { model: client(modelName), providerId, modelName };
    }
    case 'ollama': {
      const base = settings.ollamaEndpoint || 'http://localhost:11434/api';
      const client = createOllama({ baseURL: base });
      return { model: client(modelName), providerId, modelName };
    }
    case 'hermes': {
      const key = await getEffectiveApiKey(info);
      if (!key) throw new Error('Hermes API key not configured');
      const base = settings.hermesEndpoint?.trim();
      if (!base) throw new Error('Hermes endpoint not configured');
      const client = createOpenAI({ apiKey: key, baseURL: base });
      return { model: client(modelName), providerId, modelName };
    }
  }
}

export async function isLLMConfigured(): Promise<boolean> {
  try {
    await buildModel();
    return true;
  } catch {
    return false;
  }
}

export async function currentProviderLabel(): Promise<string> {
  const settings = await readStore();
  const rawId = settings.llmProvider ?? 'groq';
  const providerId: ProviderId = isProviderId(rawId) ? rawId : 'groq';
  const info = PROVIDERS[providerId];
  const ok = await isLLMConfigured();
  const modelName =
    typeof settings.llmModel === 'string' && settings.llmModel.trim()
      ? settings.llmModel
      : info.defaultModel;
  return ok ? `${info.shortLabel} · ${modelName}` : `${info.shortLabel} (not configured)`;
}

export async function* streamChat(opts: StreamChatOpts): AsyncGenerator<string> {
  const { model, providerId, modelName } = await buildModel();
  const settings = await readStore();
  const mood = await getMood();
  const ctx: PromptContext = {
    userName: settings.userName,
    mood,
    now: new Date(),
    characterId: settings.character || 'Merlin',
    externalAgent: providerId === 'hermes',
  };
  logger.debug('streamChat:', providerId, modelName);

  // Build messages. If an image is attached to the last user message, convert
  // that single turn to multipart content. Vision-capable models will see the
  // image; text-only models will (per Vercel AI SDK) downgrade gracefully or
  // emit a clear error we surface in the bubble.
  const messages: CoreMessage[] = opts.history.map((t, i, arr) => {
    const isLast = i === arr.length - 1;
    if (isLast && t.role === 'user' && opts.attachImageDataUrl) {
      return {
        role: 'user',
        content: [
          { type: 'text', text: t.content || '(what do you see on my screen?)' },
          { type: 'image', image: opts.attachImageDataUrl },
        ],
      } satisfies CoreMessage;
    }
    return { role: t.role, content: t.content } satisfies CoreMessage;
  });

  // Hermes profiles bring their own tool stack so we drop the overlapping
  // tools (web_search, task tools — Hermes has its own). But we KEEP the
  // body-control tools (move_to, move_relative, hide, show) because those
  // drive Merlin's sprite specifically and Hermes has no equivalent. Without
  // them, "slide left" can't actually move Merlin — the LLM just narrates.
  const hermesTools = {
    move_to: merlinTools.move_to,
    move_relative: merlinTools.move_relative,
    hide: merlinTools.hide,
    show: merlinTools.show,
  };
  const activeTools = providerId === 'hermes' ? hermesTools : merlinTools;
  const args = {
    model,
    system: buildSystemPrompt(ctx),
    messages,
    temperature: 0.7,
    maxSteps: 4,
    tools: activeTools,
    ...(opts.signal ? { abortSignal: opts.signal } : {}),
  };
  const result = streamText(args);
  for await (const chunk of result.textStream) {
    yield chunk;
  }
}
