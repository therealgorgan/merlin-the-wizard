import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { logger } from '../logger';

// Microsoft Edge's neural TTS service. Free, no API key — Edge browser uses
// this same endpoint for "Read Aloud." ~300 voices in many languages. Needs
// internet. We default to mp3 output so the renderer can play via data URLs
// (audio/mpeg) the same way it handles Groq Orpheus / OpenRouter audio.

let ttsInstance: MsEdgeTTS | null = null;
let currentVoice = '';

const DEFAULT_FORMAT = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;

async function getInstance(voice: string): Promise<MsEdgeTTS> {
  if (ttsInstance && currentVoice === voice) return ttsInstance;
  if (!ttsInstance) {
    logger.info('Edge TTS: creating new MsEdgeTTS instance');
    ttsInstance = new MsEdgeTTS();
  }
  logger.info('Edge TTS: setMetadata', voice);
  try {
    await ttsInstance.setMetadata(voice, DEFAULT_FORMAT);
  } catch (err) {
    logger.warn('Edge TTS setMetadata threw:', err);
    // Force a fresh instance next time in case the WebSocket is in a bad state.
    ttsInstance = null;
    throw err;
  }
  currentVoice = voice;
  return ttsInstance;
}

export async function synthesizeEdge(
  text: string,
  voice: string,
): Promise<Buffer | null> {
  try {
    const tts = await getInstance(voice);
    logger.debug('Edge TTS: requesting stream for', text.length, 'chars');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = tts.toStream(text) as any;
    const stream = result?.audioStream ?? result;
    if (!stream || typeof stream.on !== 'function') {
      logger.warn('Edge TTS: toStream returned non-stream', typeof result, result);
      return null;
    }
    return await new Promise<Buffer | null>((resolve) => {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        const buf = Buffer.concat(chunks);
        logger.info('Edge TTS: produced', buf.length, 'bytes');
        resolve(buf);
      });
      stream.on('error', (err: unknown) => {
        logger.warn('Edge TTS stream error:', err);
        resolve(null);
      });
    });
  } catch (err) {
    logger.warn('Edge TTS exception:', err);
    // Reset cache so next call retries fresh.
    ttsInstance = null;
    currentVoice = '';
    return null;
  }
}

export { EDGE_VOICES, DEFAULT_EDGE_VOICE, type EdgeVoiceOption } from '@shared/edge-voices';
