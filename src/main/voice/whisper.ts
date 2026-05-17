import { Notification } from 'electron';
import { getSecret } from '../storage/secrets';
import { logger } from '../logger';

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3-turbo';

let warnedNoKey = false;

async function getKey(): Promise<string | null> {
  const stored = await getSecret('groq_api_key');
  if (stored) return stored;
  return process.env.GROQ_API_KEY ?? null;
}

/** Transcribe a base64 audio blob via Groq Whisper. Returns the text, or null */
/** on failure. Audio should be webm/opus or mp3/wav. */
export async function transcribeAudio(
  audioBase64: string,
  mimeType: string,
): Promise<string | null> {
  const key = await getKey();
  if (!key) {
    if (!warnedNoKey && Notification.isSupported()) {
      warnedNoKey = true;
      new Notification({
        title: 'Merlin: Voice input needs a Groq key',
        body: 'Whisper transcription uses your Groq API key. Add it in Settings → Groq.',
        silent: true,
      }).show();
    }
    logger.warn('transcribeAudio: no Groq key available');
    return null;
  }

  try {
    const bin = Buffer.from(audioBase64, 'base64');
    const ext = mimeType.includes('webm')
      ? 'webm'
      : mimeType.includes('mp3') || mimeType.includes('mpeg')
        ? 'mp3'
        : mimeType.includes('wav')
          ? 'wav'
          : 'webm';
    const form = new FormData();
    const blob = new Blob([bin], { type: mimeType });
    form.append('file', blob, `recording.${ext}`);
    form.append('model', MODEL);
    form.append('response_format', 'json');

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text();
      logger.warn(`Whisper HTTP ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? '').trim();
    logger.info('Whisper transcribed:', text.slice(0, 80));
    return text || null;
  } catch (err) {
    logger.warn('Whisper transcription failed:', err);
    return null;
  }
}
