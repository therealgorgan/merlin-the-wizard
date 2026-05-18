import { Notification } from 'electron';
import { IPC } from '@shared/ipc-contract';
import { setVoiceEngine } from '../windows/spriteWindow';
import { getActiveSpriteHost } from '../activeSurface';
import { read as readStore } from '../storage/store';
import { getSecret } from '../storage/secrets';
import { logger } from '../logger';
import { synthesizeSapi } from './sapi';
import { synthesizeEdge, DEFAULT_EDGE_VOICE } from './edge';
import { synthesizeElevenLabs, DEFAULT_ELEVENLABS_VOICE } from './elevenlabs';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/speech';
const GROQ_MODEL = 'canopylabs/orpheus-v1-english';
const GROQ_VOICES = ['troy', 'austin', 'daniel', 'autumn', 'diana', 'hannah'] as const;
type GroqVoice = (typeof GROQ_VOICES)[number];
const DEFAULT_GROQ_VOICE: GroqVoice = 'troy';

const OR_ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';
const OR_MODEL = 'openai/gpt-4o-mini-tts-2025-12-15';
export const OR_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
] as const;
type ORVoice = (typeof OR_VOICES)[number];
const DEFAULT_OR_VOICE: ORVoice = 'onyx';

export type VoiceEngine = 'off' | 'sapi' | 'groq' | 'openrouter' | 'edge' | 'elevenlabs';
export const VOICE_ENGINES: readonly VoiceEngine[] = [
  'off',
  'sapi',
  'groq',
  'openrouter',
  'edge',
  'elevenlabs',
] as const;

function normalizeGroqVoice(v: string | null | undefined): GroqVoice {
  const lower = (v ?? '').toLowerCase();
  return (GROQ_VOICES as readonly string[]).includes(lower)
    ? (lower as GroqVoice)
    : DEFAULT_GROQ_VOICE;
}

function normalizeOpenRouterVoice(v: string | null | undefined): ORVoice {
  const lower = (v ?? '').toLowerCase();
  return (OR_VOICES as readonly string[]).includes(lower)
    ? (lower as ORVoice)
    : DEFAULT_OR_VOICE;
}

let queue: string[] = [];
let pumping = false;
let currentAbort: AbortController | null = null;
let sessionId = 0;

// One-shot callback the interaction layer subscribes to so it can reveal the
// bubble at exactly the moment the first audio chunk hits the renderer. Lets
// bubble visibility sync with voice instead of beating it by 1-2 seconds.
let firstAudioReadyHandler: (() => void) | null = null;
let firstAudioFiredInSession = false;

/** Register a one-shot handler fired when the next audio chunk after a */
/** session reset (cancelVoice) is sent to the renderer. */
export function onceFirstAudioReady(handler: () => void): void {
  firstAudioReadyHandler = handler;
}

export function isGroqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

export async function isOpenRouterConfigured(): Promise<boolean> {
  return Boolean(await getSecret('openrouter_api_key'));
}

export async function isElevenLabsConfigured(): Promise<boolean> {
  return Boolean(await getSecret('elevenlabs_api_key'));
}

export function cancelVoice(): void {
  sessionId++;
  queue = [];
  currentAbort?.abort();
  currentAbort = null;
  firstAudioReadyHandler = null;
  firstAudioFiredInSession = false;
  void getActiveSpriteHost().then((w) => {
    w?.webContents.send(IPC.spriteStopAudio);
  });
  // Renderer's onStopAudio handler will report active=false too, but mark
  // here as well so any voice-idle waiters resolve immediately on cancel.
  void import('./audioState').then(({ markVoiceIdle }) => markVoiceIdle());
}

/** Whether the TTS synthesis queue has work pending (or is mid-flight). */
/** Combined with the renderer's audio-playback state, lets the caller wait */
/** for *everything* — synthesis + playback — to finish before treating the */
/** turn as fully over. */
export function isSynthQueueActive(): boolean {
  return queue.length > 0 || pumping;
}

/** Resolve when the synthesis queue is empty AND not currently pumping. */
/** Polls with a small interval since there's no native event to subscribe to. */
/** Times out after `timeoutMs` to avoid hanging if the synth backend stalls. */
export async function waitForSynthDrain(timeoutMs = 60_000): Promise<void> {
  if (!isSynthQueueActive()) return;
  const start = Date.now();
  while (isSynthQueueActive()) {
    if (Date.now() - start > timeoutMs) return;
    await new Promise<void>((r) => setTimeout(r, 100));
  }
}

/**
 * Strip markdown formatting + symbols that TTS engines would verbalize as
 * "asterisk", "hash hash hash", "underscore", etc. Sentences arrive from the
 * LLM as raw text — bold/italic markers, code fences, links, list bullets,
 * table pipes, raw URLs, all leak into voice playback without this.
 *
 * Goal: speakable English. Keep semantic content; drop syntax noise.
 */
export function sanitizeForSpeech(input: string): string {
  return input
    // Code fences — too noisy to read aloud; mark with a pause instead.
    .replace(/```[\s\S]*?```/g, ' (code snippet) ')
    // Inline code — keep the content, drop the backticks.
    .replace(/`([^`]+)`/g, '$1')
    // Markdown images: ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Markdown links: [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Headers / blockquotes / list markers at line start.
    .replace(/^[ \t]*#{1,6}\s+/gm, '')
    .replace(/^[ \t]*>\s+/gm, '')
    .replace(/^[ \t]*[-*+]\s+/gm, '')
    .replace(/^[ \t]*\d+\.\s+/gm, '')
    // Bold/italic emphasis — strip markers, keep content (handle nested
    // *** ** * combinations by going widest-first).
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/___([^_]+)___/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1')
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1')
    // Strikethrough.
    .replace(/~~([^~]+)~~/g, '$1')
    // Table cell separators become spaces; row separators get stripped.
    .replace(/\|/g, ' ')
    .replace(/^[ \t]*[-:|\s]+$/gm, '')
    // Stray HTML/JSX-style tags (defense-in-depth — the function-call parser
    // already strips <function=...> blocks, but anything that slips through
    // shouldn't be spelled out).
    .replace(/<[^>]+>/g, '')
    // Raw URLs — say "link" so we don't spell out https colon slash slash...
    .replace(/https?:\/\/\S+/gi, 'link')
    // Bracketed control tags that shouldn't have leaked but defensively
    // strip anyway: [anim:...], [feel:...], [suggest:...].
    .replace(/\[(anim|feel|suggest):[^\]]*\]/gi, '')
    // Any lingering punctuation-only sequences of symbols TTS verbalizes
    // poorly. Keep . , ! ? ' " ( ) - — and parentheses for natural pauses.
    .replace(/[*_#~`<>{}\[\]]/g, '')
    // Collapse runs of whitespace.
    .replace(/\s+/g, ' ')
    .trim();
}

export async function speak(sentence: string): Promise<void> {
  const text = sanitizeForSpeech(sentence);
  if (!text) return;
  const settings = await readStore();
  const engine = settings.voiceEngine ?? 'off';
  logger.debug('speak:', text.slice(0, 60), '| engine=', engine);
  if (engine === 'off') return;
  if (engine === 'groq' && !isGroqConfigured()) {
    logger.warn('speak: groq selected but GROQ_API_KEY missing');
    return;
  }
  if (engine === 'openrouter' && !(await isOpenRouterConfigured())) {
    logger.warn('speak: openrouter selected but no API key saved');
    return;
  }
  if (engine === 'elevenlabs' && !(await isElevenLabsConfigured())) {
    logger.warn('speak: elevenlabs selected but no API key saved');
    return;
  }
  // 'edge' has no key requirement — it's Microsoft's public TTS service.
  queue.push(text);
  if (!pumping) void pump();
}

async function pump(): Promise<void> {
  pumping = true;
  const mySession = sessionId;
  while (queue.length > 0 && sessionId === mySession) {
    const text = queue.shift()!;
    try {
      const result = await synthesizeForCurrentEngine(text);
      if (result && sessionId === mySession) {
        const w = await getActiveSpriteHost();
        if (!w) {
          logger.warn('TTS audio ready but no sprite host to play it');
        } else {
          const bytes = Buffer.from(result.data);
          const dataUrl = `data:${result.mime};base64,${bytes.toString('base64')}`;
          logger.debug(
            'TTS audio sent to renderer:',
            result.data.byteLength,
            'bytes (mime:',
            result.mime,
            ')',
          );
          w.webContents.send(IPC.spritePlayAudio, dataUrl);
          // Fire the one-shot bubble-sync handler on the first audio chunk
          // of the session. Subsequent chunks don't re-trigger it.
          if (!firstAudioFiredInSession && firstAudioReadyHandler) {
            firstAudioFiredInSession = true;
            const h = firstAudioReadyHandler;
            firstAudioReadyHandler = null;
            try { h(); } catch (e) { logger.warn('firstAudioReady handler threw', e); }
          }
        }
      } else if (!result) {
        logger.debug('TTS produced no audio for chunk');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        logger.info('TTS aborted');
        break;
      }
      logger.error('TTS error', err);
    }
  }
  pumping = false;
}

interface SynthResult {
  data: ArrayBuffer;
  mime: string;
}

async function synthesizeForCurrentEngine(text: string): Promise<SynthResult | null> {
  const settings = await readStore();
  if (settings.voiceEngine === 'sapi') {
    const buf = await synthesizeSapi(text, settings.voiceName);
    if (!buf) return null;
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    return { data: ab, mime: 'audio/wav' };
  }
  if (settings.voiceEngine === 'groq') {
    const data = await synthesizeGroq(text);
    return data ? { data, mime: 'audio/wav' } : null;
  }
  if (settings.voiceEngine === 'openrouter') {
    const data = await synthesizeOpenRouter(text);
    return data ? { data, mime: 'audio/mpeg' } : null;
  }
  if (settings.voiceEngine === 'edge') {
    const voice = settings.voiceName?.includes('Neural')
      ? settings.voiceName
      : DEFAULT_EDGE_VOICE;
    const buf = await synthesizeEdge(text, voice);
    if (!buf) return null;
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    return { data: ab, mime: 'audio/mpeg' };
  }
  if (settings.voiceEngine === 'elevenlabs') {
    const key = await getSecret('elevenlabs_api_key');
    if (!key) return null;
    const voiceId = settings.voiceName?.trim() || DEFAULT_ELEVENLABS_VOICE;
    const abort = new AbortController();
    currentAbort = abort;
    try {
      const data = await synthesizeElevenLabs(text, voiceId, key, abort.signal);
      return data ? { data, mime: 'audio/mpeg' } : null;
    } finally {
      if (currentAbort === abort) currentAbort = null;
    }
  }
  return null;
}

// --- Groq path ---

let warnedTermsNeeded = false;
let warnedGeneric = false;
const TERMS_URL =
  'https://console.groq.com/playground?model=canopylabs/orpheus-v1-english';

function notifyTermsNeeded(): void {
  if (warnedTermsNeeded) return;
  warnedTermsNeeded = true;
  // Switch engine to SAPI so we don't keep retrying Groq.
  void setVoiceEngine('sapi');
  if (Notification.isSupported()) {
    new Notification({
      title: 'Merlin: Switched to Windows voice',
      body:
        "Groq requires terms acceptance for the Orpheus voice model. " +
        "Switched to Windows SAPI (offline) for now. To use Groq, accept terms at the URL in the terminal.",
      silent: true,
    }).show();
  }
  logger.warn('Groq TTS terms needed — switched engine to SAPI.\n  URL:', TERMS_URL);
}

function notifyGenericFailure(status: number, body: string): void {
  if (warnedGeneric) return;
  warnedGeneric = true;
  if (Notification.isSupported()) {
    new Notification({
      title: 'Merlin: Voice unavailable',
      body: `Groq TTS failed (HTTP ${status}). Falling back to Windows SAPI.`,
      silent: true,
    }).show();
  }
  void setVoiceEngine('sapi');
  logger.warn(`Groq TTS HTTP ${status}: ${body.slice(0, 400)}`);
}

// --- OpenRouter path ---

let warnedORGeneric = false;

async function synthesizeOpenRouter(text: string): Promise<ArrayBuffer | null> {
  const key = await getSecret('openrouter_api_key');
  if (!key) return null;
  const abort = new AbortController();
  currentAbort = abort;
  const settings = await readStore();
  const voice = normalizeOpenRouterVoice(settings.voiceName);
  logger.debug('OpenRouter TTS:', text.length, 'chars,', voice);
  try {
    const res = await fetch(OR_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'https://merlin.local',
        'X-Title': 'Merlin the Wizard',
      },
      body: JSON.stringify({
        model: OR_MODEL,
        voice,
        input: text,
        response_format: 'mp3',
      }),
      signal: abort.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      logger.warn(`OpenRouter TTS HTTP ${res.status}: ${body.slice(0, 300)}`);
      if (!warnedORGeneric && Notification.isSupported()) {
        warnedORGeneric = true;
        new Notification({
          title: 'Merlin: OpenRouter voice failed',
          body: `HTTP ${res.status}. Check your OpenRouter key and credit balance.`,
          silent: true,
        }).show();
      }
      return null;
    }
    warnedORGeneric = false;
    return await res.arrayBuffer();
  } finally {
    if (currentAbort === abort) currentAbort = null;
  }
}

async function synthesizeGroq(text: string): Promise<ArrayBuffer | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  const abort = new AbortController();
  currentAbort = abort;
  const settings = await readStore();
  const voice = normalizeGroqVoice(settings.voiceName);
  logger.debug('Groq TTS request:', text.length, 'chars,', voice);
  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        voice,
        input: text,
        response_format: 'wav',
      }),
      signal: abort.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 400 && /terms acceptance/i.test(body)) {
        notifyTermsNeeded();
      } else {
        notifyGenericFailure(res.status, body);
      }
      return null;
    }
    warnedTermsNeeded = false;
    warnedGeneric = false;
    return await res.arrayBuffer();
  } finally {
    if (currentAbort === abort) currentAbort = null;
  }
}
