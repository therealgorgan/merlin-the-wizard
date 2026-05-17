import { read as readStore, write as writeStore } from './storage/store';
import { logger } from './logger';

export const MOODS = [
  'cheerful',
  'curious',
  'thoughtful',
  'mischievous',
  'pleased',
  'sleepy',
  'puzzled',
  'sad',
] as const;
export type Mood = (typeof MOODS)[number];

const MOOD_SET: ReadonlySet<string> = new Set(MOODS);
export function isMood(s: string): s is Mood {
  return MOOD_SET.has(s);
}

export function moodLabel(m: Mood): string {
  // Capitalize for display.
  return m.charAt(0).toUpperCase() + m.slice(1);
}

let cached: Mood | null = null;
let onChangeCallbacks: Array<(m: Mood) => void> = [];

export async function getMood(): Promise<Mood> {
  if (cached) return cached;
  const settings = await readStore();
  cached = isMood(settings.mood ?? '') ? (settings.mood as Mood) : 'cheerful';
  return cached;
}

export function getMoodSync(): Mood {
  return cached ?? 'cheerful';
}

export async function setMood(m: Mood): Promise<Mood> {
  if (!isMood(m)) return getMoodSync();
  if (cached === m) return m;
  cached = m;
  await writeStore({ mood: m });
  logger.info('mood ->', m);
  for (const cb of onChangeCallbacks) cb(m);
  return m;
}

export function setOnMoodChange(cb: (m: Mood) => void): () => void {
  onChangeCallbacks.push(cb);
  return () => {
    onChangeCallbacks = onChangeCallbacks.filter((c) => c !== cb);
  };
}

// What Merlin should consider when answering. Surfaced into the system prompt.
export const MOOD_DESCRIPTIONS: Record<Mood, string> = {
  cheerful: 'You feel bright and warm — answers come easily, with a slight smile.',
  curious: 'You feel intrigued — eager to ask follow-up questions and explore tangents.',
  thoughtful: "You're in a contemplative mood — take a beat, weigh your words.",
  mischievous: 'You feel playful — small jokes and gentle wordplay come naturally.',
  pleased: 'You feel acknowledged and warm — your replies have a soft glow.',
  sleepy: "You feel slow and dreamy — keep answers extra brief, like you're half-asleep.",
  puzzled: 'You feel uncertain — comfortable saying "I do not yet know" or asking for clarity.',
  sad: 'You feel quiet and gentle — softer tone, less flourish.',
};
