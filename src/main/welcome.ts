import { IPC } from '@shared/ipc-contract';
import { showBubble } from './windows/bubbleWindow';
import { getSpriteWindow } from './windows/spriteWindow';
import {
  getChatPanelWindow,
  panelAddIdleThought,
} from './windows/chatPanelWindow';
import { read as readStore } from './storage/store';
import { speak as ttsSpeak } from './voice/tts';
import { isEnabled } from './extensions';
import { logger } from './logger';

const WELCOME_DURATION_MS = 12_000;
// Panel welcome lingers longer than the bubble welcome — the bubble fades on
// its own to clear screen space, while the panel thought is unobtrusive and
// benefits from extra time to be read or engaged with.
const WELCOME_PANEL_TTL_MS = 120_000;

function timeOfDay(date: Date): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = date.getHours();
  if (h < 5) return 'night';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 22) return 'evening';
  return 'night';
}

interface WelcomeText {
  bubble: string;
  spoken: string;
}

const HINT = '\n\nDouble-click me to chat, or right-click for more options.';

// 12 daytime greetings (morning + afternoon + evening — "the sun's out" set)
// and 12 nighttime greetings. Picked at random within the correct bucket each
// boot, so users see fresh variety instead of the same line every time.

const DAYTIME_GREETINGS: readonly WelcomeText[] = [
  { spoken: "Good day to thee, traveler. Merlin, at your service.",
    bubble: "Good day to thee, traveler. Merlin, at your service." },
  { spoken: "Hail and well met! I am Merlin, returned from the ether.",
    bubble: "Hail and well met! I am Merlin, returned from the ether." },
  { spoken: "Ah, you summon me into the daylight. How may I be of use?",
    bubble: "Ah, you summon me into the daylight. How may I be of use?" },
  { spoken: "Greetings, friend. The day is young and so are my spells.",
    bubble: "Greetings, friend. The day is young and so are my spells." },
  { spoken: "By my staff — a familiar face! Merlin reporting for duty.",
    bubble: "By my staff — a familiar face! Merlin reporting for duty." },
  { spoken: "The sun is up and so am I. What shall we conjure today?",
    bubble: "The sun is up and so am I. What shall we conjure today?" },
  { spoken: "Good morrow! 'Tis a fine hour for questions and answers alike.",
    bubble: "Good morrow! 'Tis a fine hour for questions and answers alike." },
  { spoken: "Welcome back, mortal. Your humble wizard awaits your bidding.",
    bubble: "Welcome back, mortal. Your humble wizard awaits your bidding." },
  { spoken: "Ah, you've found me. Don't tell the others — they get jealous.",
    bubble: "Ah, you've found me. Don't tell the others — they get jealous." },
  { spoken: "A wizard's day begins when you say it does. So... begins now?",
    bubble: "A wizard's day begins when you say it does. So... begins now?" },
  { spoken: "Pleased to see you, friend. The library of all knowledge is open.",
    bubble: "Pleased to see you, friend. The library of all knowledge is open." },
  { spoken: "Bright day, bright mind. What mystery shall we unravel?",
    bubble: "Bright day, bright mind. What mystery shall we unravel?" },
];

const NIGHTTIME_GREETINGS: readonly WelcomeText[] = [
  { spoken: "Good evening, friend. The owls and I keep watch.",
    bubble: "Good evening, friend. The owls and I keep watch." },
  { spoken: "The hour grows late. Merlin abides, as ever.",
    bubble: "The hour grows late. Merlin abides, as ever." },
  { spoken: "Burning the midnight oil? Then so shall I.",
    bubble: "Burning the midnight oil? Then so shall I." },
  { spoken: "Greetings, night-walker. The moon and I welcome you back.",
    bubble: "Greetings, night-walker. The moon and I welcome you back." },
  { spoken: "Ah, a candle in the dark. What troubles thy mind at this hour?",
    bubble: "Ah, a candle in the dark. What troubles thy mind at this hour?" },
  { spoken: "Past wizard's bedtime, but I'm yours all the same.",
    bubble: "Past wizard's bedtime, but I'm yours all the same." },
  { spoken: "The stars are clearer tonight. So, perhaps, is the answer.",
    bubble: "The stars are clearer tonight. So, perhaps, is the answer." },
  { spoken: "Welcome, friend of the witching hour. Speak softly — the cats are listening.",
    bubble: "Welcome, friend of the witching hour. Speak softly — the cats are listening." },
  { spoken: "Late again, are we? Worry not, sleep is for amateurs.",
    bubble: "Late again, are we? Worry not, sleep is for amateurs." },
  { spoken: "The owls hoot, the moon climbs, and Merlin appears. Ask away.",
    bubble: "The owls hoot, the moon climbs, and Merlin appears. Ask away." },
  { spoken: "Hail, night traveler. Even in darkness, knowledge has its torch.",
    bubble: "Hail, night traveler. Even in darkness, knowledge has its torch." },
  { spoken: "All sensible folk are asleep. Lucky for us both, neither of us is sensible.",
    bubble: "All sensible folk are asleep. Lucky for us both, neither of us is sensible." },
];

function isDaytime(slot: ReturnType<typeof timeOfDay>): boolean {
  // Morning, afternoon, evening = "sun is out / about" feel.
  // Only midnight–5am gets the night-set.
  return slot === 'morning' || slot === 'afternoon' || slot === 'evening';
}

function pickWelcome(): WelcomeText {
  const slot = timeOfDay(new Date());
  const pool = isDaytime(slot) ? DAYTIME_GREETINGS : NIGHTTIME_GREETINGS;
  const pick = pool[Math.floor(Math.random() * pool.length)]!;
  return { bubble: pick.bubble + HINT, spoken: pick.spoken };
}

export async function playWelcome(): Promise<void> {
  const sprite = getSpriteWindow();
  if (!sprite) {
    logger.warn('playWelcome: no sprite window');
    return;
  }
  const settings = await readStore();
  if (!isEnabled('behavior.voice.welcome')) {
    logger.info('Welcome skipped (behavior.voice.welcome is off)');
    return;
  }

  const { bubble, spoken } = pickWelcome();

  // Send Greet + Wave to whichever surface is the active sprite host.
  // In modern mode that's the embedded clippyjs in the panel; in classic
  // it's the floating sprite window.
  const { getActiveSpriteHost } = await import('./activeSurface');
  const host = await getActiveSpriteHost();
  host?.webContents.send(IPC.spritePlay, 'Greet');
  setTimeout(() => {
    void getActiveSpriteHost().then((h) => h?.webContents.send(IPC.spritePlay, 'Wave'));
  }, 1800);
  setTimeout(() => {
    if (settings.displayMode === 'modern') {
      // Modern mode: surface the welcome as an idle-thought turn in the panel
      // so the user actually sees it. The panel might still be loading when
      // welcome fires (we kick off in parallel at boot), so retry briefly
      // until it's visible. Times out after ~5s to avoid hanging.
      tryEmitWelcomeToPanel(bubble.replace(HINT, '').trim(), 0);
    } else {
      // Classic mode: floating speech bubble next to the sprite.
      showBubble(bubble, { mode: 'read', durationMs: WELCOME_DURATION_MS });
    }
    if (isEnabled('behavior.voice.welcome_spoken') && settings.voiceEngine !== 'off') {
      void ttsSpeak(spoken);
    }
  }, 600);
}

function tryEmitWelcomeToPanel(text: string, attempt: number): void {
  const panel = getChatPanelWindow();
  if (panel && panel.isVisible()) {
    const now = Date.now();
    panelAddIdleThought({
      id: `welcome-${now}`,
      text,
      emittedAt: now,
      ttlMs: WELCOME_PANEL_TTL_MS,
    });
    return;
  }
  if (attempt >= 10) {
    logger.warn('welcome: panel never became visible, dropping welcome thought');
    return;
  }
  setTimeout(() => tryEmitWelcomeToPanel(text, attempt + 1), 500);
}
