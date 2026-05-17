import { IPC, type BubblePayload } from '@shared/ipc-contract';
import { StreamingAnimParser } from '@shared/animation-protocol';
import { FunctionCallParser } from '@shared/function-call-parser';
import { executeToolByName } from './llm/toolHandlers';
import { getSpriteWindow } from './windows/spriteWindow';
import {
  showBubble,
  hideBubble,
  appendBubbleText,
  getBubbleWindow,
  setBubbleMode,
  setBubbleSuggestions,
} from './windows/bubbleWindow';
import { streamChat, isLLMConfigured } from './llm/providerRegistry';
import {
  appendTurn,
  clearHistory,
  getHistorySnapshot,
  loadHistory,
  type ChatTurn,
} from './storage/conversationStore';
import { setMood, isMood } from './feelings';
import { speak as ttsSpeak, cancelVoice, onceFirstAudioReady } from './voice/tts';
import { SentenceSplitter } from './voice/sentenceSplitter';
import { markInteraction } from './brain';
import { consumePendingAttachments } from './attachments';
import { consumePendingScreenshot } from './screenCapture';
import { read as readStore } from './storage/store';
import * as anim from './animationController';
import {
  panelAddUserTurn,
  panelAppendAssistantChunk,
  panelFinalizeAssistant,
  panelSetStreaming,
  panelSetSuggestions,
  focusPanelInput,
  showChatPanel,
} from './windows/chatPanelWindow';
import { logger } from './logger';

const ASK_PROMPT = 'What can I help you with, traveler?';

// Models love to narrate physical actions in italic asterisks even when we
// give them a movement tool. The user sees "*slides to the left*" and thinks
// it's fake (because it is — no actual movement happens). This filter strips
// asterisk-wrapped italic spans that start with a known motion verb. Handles
// streaming: holds back unclosed-asterisk content until the close arrives.
class ItalicActionFilter {
  private buf = '';
  private static readonly ACTION_VERB_RE = new RegExp(
    '^\\*\\s*(slides?|slid(?:e|den)?|walks?|walked|walking|runs?|ran|running|' +
    'moves?|moved|moving|glides?|glided|gliding|floats?|floated|floating|' +
    'hops?|hopped|hopping|flies|flew|flown|flying|sits?|sat|sitting|' +
    'stands?|stood|standing|hides?|hid|hiding|vanish(?:es|ed|ing)?|' +
    'drifts?|drifted|drifting|scoots?|scooted|scooting|leans?|leaned|leaning|' +
    'points?|pointed|pointing|gestures?|gestured|gesturing|bows?|bowed|bowing|' +
    'spins?|spun|spinning|twirls?|twirled|twirling|dances?|danced|dancing|' +
    'steps?|stepped|stepping|prances?|pranced|prancing|swoops?|swooped|swooping|' +
    'sails?|sailed|sailing|rises?|rose|risen|rising|falls?|fell|fallen|falling|' +
    'jumps?|jumped|jumping|marches?|marched|marching|skips?|skipped|skipping|' +
    'sashays|sashayed|sashaying|struts?|strutted|strutting|paces?|paced|pacing|' +
    'appears?|appeared|appearing|disappears?|disappeared|disappearing|' +
    'reappears?|reappeared|reappearing|lifts?|lifted|lifting|drops?|dropped|dropping|' +
    'swirls?|swirled|swirling|saunters?|sauntered|sauntering|' +
    'wanders?|wandered|wandering|teleports?|teleported|teleporting|' +
    'materializes?|materialized|materializing|appearing|nods?|nodded|nodding|' +
    'waves?|waved|waving|claps?|clapped|clapping|conjures?|conjured|conjuring|' +
    'casts?|casted|casting|flourish(?:es|ed|ing)?|with a flourish|smiles?|smiled|smiling|' +
    'looks?|looked|looking|peeks?|peeked|peeking|tilts?|tilted|tilting)\\b',
    'i'
  );
  push(text: string): string {
    this.buf += text;
    let out = '';
    let i = 0;
    while (i < this.buf.length) {
      const openIdx = this.buf.indexOf('*', i);
      if (openIdx === -1) {
        out += this.buf.slice(i);
        this.buf = '';
        return out;
      }
      out += this.buf.slice(i, openIdx);
      const closeIdx = this.buf.indexOf('*', openIdx + 1);
      if (closeIdx === -1) {
        // Incomplete italic — hold back from the open onward.
        this.buf = this.buf.slice(openIdx);
        return out;
      }
      const span = this.buf.slice(openIdx, closeIdx + 1);
      if (ItalicActionFilter.ACTION_VERB_RE.test(span)) {
        // Drop it — never reaches the bubble or TTS.
        logger.debug('stripped italic action narration:', span.slice(0, 60));
      } else {
        out += span;
      }
      i = closeIdx + 1;
    }
    this.buf = '';
    return out;
  }
  flush(): string {
    const rem = this.buf;
    this.buf = '';
    return rem;
  }
}

const CANNED_REPLIES = [
  "By my staff, that is a fine question! Alas, my voice is unbound — set GROQ_API_KEY to summon my proper reply.",
  "Hmm... I hear thee, but my oracle is sleeping. The .env file awaits a key.",
];

function pickCannedReply(): string {
  return CANNED_REPLIES[Math.floor(Math.random() * CANNED_REPLIES.length)]!;
}

// LLM emits inline [anim:Name] tags — route through the AnimationController
// so it can apply side effects (Hide/Show) and gesture cycle bookkeeping.
function play(animation: string): void {
  anim.playInline(animation);
}

let activeAbort: AbortController | null = null;

void loadHistory();

export function openAskBubble(): void {
  markInteraction();
  anim.reactToDoubleClick();
  // Route to the active display surface — bubble in classic, panel in modern.
  void (async () => {
    const s = await readStore();
    if (s.displayMode === 'modern') {
      showChatPanel();
      focusPanelInput();
    } else {
      showBubble(ASK_PROMPT, { mode: 'ask' });
    }
  })();
}

export function dismissBubble(): void {
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }
  anim.chatAborted();
  cancelVoice();
  hideBubble();
}

export async function forgetConversation(): Promise<void> {
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }
  anim.chatAborted();
  cancelVoice();
  await clearHistory();
  play('DoMagic2');
  showBubble('Poof. My memory is a clean parchment again.', {
    mode: 'read',
    durationMs: 6_000,
  });
}

export function handleUserMessage(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  // Prepend any files the user dragged in since their last submit.
  const withAttachments = consumePendingAttachments(trimmed);
  logger.info('user said:', trimmed.slice(0, 80));
  if (withAttachments !== trimmed) {
    logger.info('  + attachments prepended (', withAttachments.length, 'chars total)');
  }
  markInteraction();

  void appendTurn({ role: 'user', content: withAttachments, timestamp: Date.now() });
  // Reflect the user's turn in the modern panel immediately if it's active.
  void readStore().then((s) => {
    if (s.displayMode === 'modern') panelAddUserTurn(trimmed);
  });
  // Affective reaction: scan the user's text for "thanks"/"?!"/etc and queue
  // a quick mood-appropriate gesture.
  void anim.contentReaction(trimmed);

  // Cancel any in-flight stream + voice from a prior question.
  activeAbort?.abort();
  cancelVoice();

  void (async () => {
    if (!(await isLLMConfigured())) {
      anim.chatStart();
      setTimeout(() => {
        play('DoMagic1');
        const reply = pickCannedReply();
        void appendTurn({ role: 'assistant', content: reply, timestamp: Date.now() });
        showBubble(reply, { mode: 'read', durationMs: 20_000 });
        anim.chatEnd();
      }, 900);
      return;
    }
    await streamFromProvider();
  })();
}

async function streamFromProvider(): Promise<void> {
  const abort = new AbortController();
  activeAbort = abort;
  // Consume any pending screenshot — only attached to *this* turn.
  const screenshot = consumePendingScreenshot();

  // Snapshot the active display surface for this turn. We don't react to
  // mid-stream mode switches; whichever mode was active when the stream
  // started owns the rendering until it finishes.
  const settings = await readStore();
  const modernMode = settings.displayMode === 'modern';

  if (modernMode) {
    // Modern panel manages its own thread + "typing" placeholder — main just
    // signals streaming-start. Hide the classic bubble in case it was open
    // from a prior turn before the user switched modes.
    hideBubble();
    panelSetSuggestions([]);
    panelSetStreaming(true);
  } else {
    // Classic: hide the bubble during thinking; reveal happens when voice or
    // text-ready triggers showBubbleWithBuffer.
    hideBubble();
    const w = getBubbleWindow();
    if (w) {
      const payload: BubblePayload = { text: '', mode: 'read' };
      w.webContents.send(IPC.bubbleSetText, payload);
    }
    setBubbleSuggestions([]);
  }

  anim.chatStart();

  const fnParser = new FunctionCallParser();
  const parser = new StreamingAnimParser();
  const splitter = new SentenceSplitter();
  const italicFilter = new ItalicActionFilter();
  let assistantTextWithTags = ''; // for history (includes [feel:] etc.)
  let visibleText = '';
  let bubbleShown = false;
  const suggestions: string[] = [];

  // Bubble/voice sync: when voice is enabled, buffer the streaming text
  // invisibly until the first audio chunk is actually queued in the renderer,
  // then reveal the whole buffered prefix at once and append from there. This
  // closes the 1-2s gap between "bubble appears reading" and "voice starts."
  // Timeout fallback ensures the bubble shows even if voice fails or stalls.
  // Modern mode skips the buffering entirely — the panel renders chunks live.
  const voiceEngine = settings.voiceEngine ?? 'off';
  const waitForVoice = voiceEngine !== 'off' && !modernMode;
  let bufferedText = '';
  let voiceSyncFallbackTimer: NodeJS.Timeout | null = null;

  const showBubbleWithBuffer = (firstChunk: string): void => {
    if (bubbleShown) return;
    const textToShow = (bufferedText || firstChunk).trim();
    // Never show an empty bubble — that's the "appears too early" bug. If we
    // got here without text (e.g. fallback timer fired before any chunk
    // arrived), stay hidden and let renderText or the stream-end flush
    // trigger the show whenever real content shows up.
    if (!textToShow) {
      logger.debug('showBubbleWithBuffer: skipping empty reveal');
      return;
    }
    if (voiceSyncFallbackTimer) {
      clearTimeout(voiceSyncFallbackTimer);
      voiceSyncFallbackTimer = null;
    }
    showBubble(bufferedText || firstChunk, { mode: 'read', durationMs: 0 });
    bubbleShown = true;
    bufferedText = '';
    anim.chatFirstReply();
  };

  if (waitForVoice) {
    onceFirstAudioReady(() => {
      // First audio chunk hit the renderer — show now so the bubble appears
      // in the same frame as audio playback. By this point bufferedText is
      // guaranteed non-empty (audio comes from a synthesized sentence).
      showBubbleWithBuffer('');
    });
  }

  const renderText = (rawText: string): void => {
    // Pass through the italic-action filter first — drops "*slides left*"
    // style narration before it reaches the bubble or TTS. Holds back
    // unclosed-asterisk content until the close arrives.
    const text = italicFilter.push(rawText);
    if (!text) return;
    visibleText += text;
    for (const sentence of splitter.push(text)) {
      void ttsSpeak(sentence);
    }
    if (modernMode) {
      // Modern mode streams every chunk straight into the panel's last
      // assistant turn — no buffering, no bubble, no voice-sync timer.
      panelAppendAssistantChunk(text);
      // Mark `bubbleShown` true so any classic-side post-stream paths
      // (suggestions, mode swap) become no-ops without crashing.
      bubbleShown = true;
      return;
    }
    if (bubbleShown) {
      appendBubbleText(text);
    } else if (waitForVoice) {
      // Hold text until audio is ready. The fallback timer below is started
      // here (not at stream start) so we only count 1.8s after we *have*
      // text — that way the bubble can never reveal empty.
      bufferedText += text;
      if (!voiceSyncFallbackTimer) {
        voiceSyncFallbackTimer = setTimeout(() => {
          logger.debug('voice-sync fallback timer fired — revealing bubble');
          showBubbleWithBuffer('');
        }, 1800);
      }
    } else {
      // Voice off — show immediately on first text.
      showBubbleWithBuffer(text);
    }
  };

  // Tools must run sequentially, not in parallel. Multiple move_to calls
  // racing each other = bubble ghosts, sprite ends up at random corner.
  // Chained promise serializes them. We track it so we can await drain.
  let toolChain: Promise<void> = Promise.resolve();
  const enqueueTool = (name: string, args: unknown): void => {
    toolChain = toolChain.then(async () => {
      logger.info('inline tool call:', name, args);
      anim.toolStart(name);
      let ok = false;
      try {
        const result = await executeToolByName(name, args);
        // executeToolByName returns { ok: bool, ... } for our tools;
        // anything else (truthy) we treat as success.
        if (typeof result === 'object' && result !== null && 'ok' in result) {
          ok = (result as { ok: boolean }).ok === true;
        } else {
          ok = result !== undefined && result !== null;
        }
      } catch (err) {
        logger.error('tool error:', name, err);
        ok = false;
      }
      void anim.toolFinish(name, ok);
    });
  };

  const handleChunk = (raw: string): void => {
    const fn = fnParser.push(raw);
    for (const call of fn.calls) {
      enqueueTool(call.name, call.args);
    }
    if (!fn.text) return;
    for (const p of parser.push(fn.text)) {
      if (p.type === 'anim') {
        play(p.name);
      } else if (p.type === 'feel') {
        if (isMood(p.mood)) void setMood(p.mood);
      } else if (p.type === 'suggest') {
        suggestions.push(p.text);
      } else if (p.value) {
        renderText(p.value);
      }
    }
  };

  const history = getHistorySnapshot().map(
    (t): { role: 'user' | 'assistant'; content: string } => ({
      role: t.role,
      content: t.content,
    }),
  );

  try {
    for await (const chunk of streamChat({
      history,
      signal: abort.signal,
      ...(screenshot ? { attachImageDataUrl: screenshot.dataUrl } : {}),
    })) {
      if (abort.signal.aborted) break;
      assistantTextWithTags += chunk;
      handleChunk(chunk);
    }
    // Drain both parsers.
    const fnTail = fnParser.flush();
    if (fnTail.text) handleChunk(fnTail.text);
    for (const p of parser.flush()) {
      if (p.type === 'anim') play(p.name);
      else if (p.type === 'feel') {
        if (isMood(p.mood)) void setMood(p.mood);
      } else if (p.type === 'suggest') {
        suggestions.push(p.text);
      } else if (p.value) {
        renderText(p.value);
      }
    }
    // Flush the italic filter — emits any held-back unclosed-italic content
    // as plain text (better to show it than swallow it on an actual unclosed
    // italic that the user might intend to be a real word with an asterisk).
    const filterTail = italicFilter.flush();
    if (filterTail) {
      visibleText += filterTail;
      for (const sentence of splitter.push(filterTail)) {
        void ttsSpeak(sentence);
      }
      if (bubbleShown) appendBubbleText(filterTail);
      else if (modernMode) panelAppendAssistantChunk(filterTail);
      else bufferedText += filterTail;
    }
    const tail = splitter.flush();
    if (tail) void ttsSpeak(tail);
    // Stream finished — flush any buffered text that was waiting on voice.
    // (Voice may have failed silently, or stream may have been so short that
    // audio hadn't fired yet.) If there's text and the bubble's still hidden,
    // reveal it now.
    if (!bubbleShown && (bufferedText || visibleText)) {
      showBubbleWithBuffer(bufferedText || visibleText);
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      logger.info('stream aborted');
      return;
    }
    logger.error('streamChat failed', err);
    // If we never showed the bubble yet, the user has no signal at all that
    // anything went wrong — pop it open with the error. Otherwise append.
    const errMsg = '(...something disturbs the connection. Try again?)';
    if (!bubbleShown) {
      showBubble(errMsg, { mode: 'read', durationMs: 6_000 });
      bubbleShown = true;
    } else {
      appendBubbleText('\n\n' + errMsg);
    }
  } finally {
    if (activeAbort === abort) activeAbort = null;
  }

  // Wait for any queued tool calls to drain before we declare the turn done.
  // Otherwise bubble switch + suggestions appear while move_to is still gliding.
  await toolChain;

  if (visibleText.trim()) {
    await appendTurn({
      role: 'assistant',
      content: assistantTextWithTags.trim(),
      timestamp: Date.now(),
    });
  }

  if (modernMode) {
    panelFinalizeAssistant(visibleText.trim());
    panelSetSuggestions(suggestions.slice(0, 4));
    panelSetStreaming(false);
    logger.debug('reply done (modern)', {
      suggestions: suggestions.length,
      replyChars: visibleText.length,
    });
  } else if (visibleText.trim()) {
    setBubbleMode('ask');
    setBubbleSuggestions(suggestions.slice(0, 4));
    logger.debug('reply done', {
      suggestions: suggestions.length,
      replyChars: visibleText.length,
    });
  }
  anim.chatEnd();
}

export type { ChatTurn };
