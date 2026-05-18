import { Notification } from 'electron';
import { logger } from '../logger';

// ElevenLabs TTS — full Voice Library access. The user picks any voice
// (built-in or one they've added from the public Voice Library at
// elevenlabs.io/voice-library) and pastes its voice_id into Settings.
//
// API surface used:
//   POST /v1/text-to-speech/{voice_id}
//   headers: { 'xi-api-key': key, 'content-type': 'application/json' }
//   body:    { text, model_id, voice_settings? }
//   response: audio/mpeg
//
// Cost note: ElevenLabs bills per-character. The free tier is small (~10k
// chars/month). We pass the text un-modified except for our usual
// sanitizeForSpeech pass (done upstream in tts.ts).

const ELEVENLABS_ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech';

// `eleven_multilingual_v2` works with the broadest set of voices including
// most community/Voice Library voices. Turbo (`eleven_turbo_v2_5`) is faster
// and cheaper but rejects some voices outright with an opaque 400 — which is
// why voice IDs copied straight from the Voice Library sometimes silently
// failed before. Compatibility > latency for the default.
const DEFAULT_MODEL = 'eleven_multilingual_v2';

// A handful of well-known stable voice IDs ElevenLabs ships out of the box
// — exposed in the settings dropdown as a starter set. The user can also
// paste any other voice_id (including ones from the Voice Library) into
// the custom field.
export const ELEVENLABS_PRESET_VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel — calm female (default)' },
  { id: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi — strong female' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella — soft female' },
  { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni — well-rounded male' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', label: 'Elli — emotional female' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh — deep male' },
  { id: 'VR6AewLTigWG4xSOukaG', label: 'Arnold — crisp male' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam — narration male' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', label: 'Sam — raspy male' },
] as const;

export const DEFAULT_ELEVENLABS_VOICE = ELEVENLABS_PRESET_VOICES[0].id;

let warnedAuthFailure = false;
let warnedVoiceFailure = new Set<string>();
let warnedGeneric = false;

function notifyVoiceFailure(voiceId: string, status: number, body: string): void {
  if (warnedVoiceFailure.has(voiceId)) return;
  warnedVoiceFailure.add(voiceId);
  let hint = '';
  if (status === 402) {
    hint =
      ' — ElevenLabs free tier doesn\'t allow API access to Voice Library voices. ' +
      'Use a built-in voice (Rachel, Adam, etc.) or upgrade your plan.';
  } else if (status === 400 || status === 422) {
    hint = ' — voice may not be in your account, or this model isn\'t supported for it.';
  } else if (status === 401 || status === 403) {
    hint = ' — API key invalid or lacks permission for this voice.';
  } else if (status === 404) {
    hint = ' — voice ID not found. Add it from the Voice Library to your account first.';
  }
  if (Notification.isSupported()) {
    // `silent: false` so Windows Focus Assist doesn't filter it out.
    new Notification({
      title: 'Merlin: ElevenLabs voice failed',
      body: `HTTP ${status} for voice ${voiceId.slice(0, 12)}...${hint}`,
      silent: false,
    }).show();
  }
  logger.warn(`ElevenLabs HTTP ${status} (voice ${voiceId}): ${body.slice(0, 400)}`);
}

export async function synthesizeElevenLabs(
  text: string,
  voiceId: string,
  apiKey: string,
  abortSignal: AbortSignal,
): Promise<ArrayBuffer | null> {
  if (!apiKey) {
    if (!warnedAuthFailure) {
      warnedAuthFailure = true;
      logger.warn('ElevenLabs TTS: no API key configured');
    }
    return null;
  }
  const id = voiceId?.trim() || DEFAULT_ELEVENLABS_VOICE;
  // Info-level so it's visible in normal dev logs without needing debug mode.
  // If you don't see this line when expecting voice, the synth isn't even
  // being called — check voice engine setting + that text reached speak().
  logger.info(`ElevenLabs TTS request: voice=${id} model=${DEFAULT_MODEL} chars=${text.length}`);
  const url = `${ELEVENLABS_ENDPOINT}/${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: DEFAULT_MODEL,
      }),
      signal: abortSignal,
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 401) {
        if (!warnedAuthFailure) {
          warnedAuthFailure = true;
          if (Notification.isSupported()) {
            new Notification({
              title: 'Merlin: ElevenLabs unauthorized',
              body: 'API key is invalid or missing required permissions.',
              silent: true,
            }).show();
          }
          logger.warn('ElevenLabs TTS HTTP 401 — invalid API key');
        }
        return null;
      }
      notifyVoiceFailure(id, res.status, body);
      return null;
    }
    // ElevenLabs returns audio/mpeg on success. If we got something else,
    // it's an error payload masquerading as 200 — surface it.
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.toLowerCase().startsWith('audio/')) {
      const body = await res.text();
      logger.warn(
        `ElevenLabs 200 but non-audio content-type "${ct}": ${body.slice(0, 400)}`,
      );
      notifyVoiceFailure(id, 200, body);
      return null;
    }
    warnedAuthFailure = false;
    warnedGeneric = false;
    warnedVoiceFailure.delete(id);
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) {
      logger.warn(`ElevenLabs returned 0 bytes for voice ${id}`);
      notifyVoiceFailure(id, 200, '(empty body)');
      return null;
    }
    logger.info(`ElevenLabs success: voice=${id} bytes=${buf.byteLength}`);
    return buf;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    logger.warn('ElevenLabs TTS network error', err);
    if (!warnedGeneric) {
      warnedGeneric = true;
      if (Notification.isSupported()) {
        new Notification({
          title: 'Merlin: ElevenLabs network error',
          body: 'Failed to reach api.elevenlabs.io. Check your connection.',
          silent: true,
        }).show();
      }
    }
    return null;
  }
}
