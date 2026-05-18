import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { marked } from 'marked';
import type { PanelChatTurn, PanelIdleThought } from '@shared/ipc-contract';

// The chat panel is JUST a chat surface in this design — the actual sprite
// lives in its own floating window (the standalone sprite window) alongside
// the panel. No clippyjs in this renderer; no voice playback either (TTS
// audio routes to the sprite window directly via the active-surface logic
// in main).

marked.setOptions({ gfm: true, breaks: true });

const api = window.panelApi!;

interface DraftAttachment {
  name: string;
  isScreenshot?: boolean;
  width?: number;
  height?: number;
  bytes?: number;
  error?: string;
}

function App(): React.ReactElement {
  const [character, setCharacter] = useState('Merlin');
  const [turns, setTurns] = useState<PanelChatTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [pendingScreenshot, setPendingScreenshot] = useState<{
    width: number; height: number; bytes: number;
  } | null>(null);
  const [recording, setRecording] = useState(false);
  const [audioActive, setAudioActive] = useState(false);
  const [idleThoughts, setIdleThoughts] = useState<PanelIdleThought[]>([]);
  // Re-render tick used to update countdown displays; bumped every second
  // while at least one idle thought is visible.
  const [, setTick] = useState(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Tick once per second to refresh the countdown labels on transient idle
  // thoughts, and drop any whose TTL has expired. Permanent thoughts (those
  // the user has engaged with) are skipped — they stay in the thread forever.
  // The interval idles cleanly when there are no transient thoughts left.
  useEffect(() => {
    const hasTransient = idleThoughts.some((t) => !t.permanent);
    if (!hasTransient) return;
    const handle = window.setInterval(() => {
      const now = Date.now();
      setIdleThoughts((prev) =>
        prev.filter((t) => t.permanent || t.emittedAt + t.ttlMs > now),
      );
      setTick((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(handle);
  }, [idleThoughts]);

  const dismissIdleThought = (id: string): void => {
    setIdleThoughts((prev) => prev.filter((t) => t.id !== id));
    api.dismissIdleThought(id);
  };

  const respondToIdleThought = (thought: PanelIdleThought): void => {
    // Treat clicking the thought as the user wanting to engage with it —
    // pre-fill the input with a friendly reply prompt, then dismiss.
    setInput(thought.text);
    inputRef.current?.focus();
    dismissIdleThought(thought.id);
  };

  // Initial fetch: character + history
  useEffect(() => {
    void (async () => {
      const init = await api.getInitial();
      setCharacter(init.character);
      setTurns(init.history ?? []);
      const shot = await api.getPendingScreenshot();
      if (shot) setPendingScreenshot(shot);
    })();
  }, []);

  // Auto-scroll thread to bottom on new content
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, streaming]);

  // Also scroll when an idle thought is *added* (not when one expires — don't
  // yank scroll position out from under the user just because a thought timed
  // out). Tracks the prior count so we can distinguish growth from shrink.
  const prevIdleCountRef = useRef(0);
  useEffect(() => {
    const el = threadRef.current;
    if (el && idleThoughts.length > prevIdleCountRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevIdleCountRef.current = idleThoughts.length;
  }, [idleThoughts.length]);

  // IPC subscriptions
  useEffect(() => {
    const offUser = api.onAddUserTurn((text: string) => {
      setTurns((prev) => [...prev, {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
      }]);
      setSuggestions([]);
    });
    const offChunk = api.onAppendAssistantChunk((chunk: string) => {
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant' && last.streaming) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + chunk },
          ];
        }
        // No streaming turn yet — start one.
        return [...prev, {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: chunk,
          timestamp: Date.now(),
          streaming: true,
        }];
      });
    });
    const offStreaming = api.onSetStreaming((s: boolean) => {
      setStreaming(s);
      if (s) {
        // Adding a placeholder turn so the "Merlin is thinking" indicator shows
        setTurns((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && last.streaming) return prev;
          return [...prev, {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            streaming: true,
          }];
        });
      }
    });
    const offFinal = api.onFinalizeAssistant((text: string) => {
      setStreaming(false);
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant' && last.streaming) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: text || last.content, streaming: false },
          ];
        }
        return prev;
      });
    });
    const offSug = api.onSetSuggestions((items: string[]) => setSuggestions(items));
    const offOpen = api.onOpenForAsk(() => inputRef.current?.focus());
    const offTail = api.onSetTailSide((placement) => {
      // Same tail-positioning protocol as the speech bubble — the dataset
      // attribute picks which CSS rules apply (which edge sticks out) and
      // the CSS variable slides the tail along that edge so it tracks Merlin
      // when he isn't aligned with the panel's midpoint.
      document.body.dataset.tail = placement.side;
      document.body.style.setProperty('--tail-offset', String(placement.offset));
    });
    const offIdle = api.onAddIdleThought((thought) => {
      // Append (replace any existing one with the same id to be idempotent).
      setIdleThoughts((prev) => [...prev.filter((t) => t.id !== thought.id), thought]);
    });
    const offAudio = api.onSetAudioActive((active) => setAudioActive(active));
    return () => {
      offUser(); offChunk(); offStreaming(); offFinal();
      offSug(); offOpen(); offTail(); offIdle(); offAudio();
    };
  }, []);

  // Drag-drop handlers
  useEffect(() => {
    let depth = 0;
    const onEnter = (e: DragEvent): void => {
      e.preventDefault();
      depth++;
      document.body.classList.add('drop-target');
    };
    const onLeave = (e: DragEvent): void => {
      e.preventDefault();
      depth--;
      if (depth <= 0) {
        depth = 0;
        document.body.classList.remove('drop-target');
      }
    };
    const onOver = (e: DragEvent): void => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = async (e: DragEvent): Promise<void> => {
      e.preventDefault();
      depth = 0;
      document.body.classList.remove('drop-target');
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      for (const f of Array.from(files)) {
        const result = await api.attachDroppedFile(f);
        if (result?.ok && result.name) {
          setAttachments((prev) => [...prev, { name: result.name! }]);
        } else if (result && !result.ok) {
          setAttachments((prev) => [...prev, { name: f.name, error: result.error ?? 'rejected' }]);
        }
      }
    };
    document.addEventListener('dragenter', onEnter);
    document.addEventListener('dragleave', onLeave);
    document.addEventListener('dragover', onOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragenter', onEnter);
      document.removeEventListener('dragleave', onLeave);
      document.removeEventListener('dragover', onOver);
      document.removeEventListener('drop', onDrop);
    };
  }, []);

  const submit = (): void => {
    const text = input.trim();
    if (!text && !pendingScreenshot && attachments.length === 0) return;
    // Promote any visible idle thoughts to permanent — the user is engaging
    // with the conversation, so the thought becomes part of the record
    // instead of fading away mid-reply. Also notify main so the dismiss-
    // cooldown updates (the user's reply effectively "answers" the thought).
    setIdleThoughts((prev) => {
      for (const t of prev) {
        if (!t.permanent) api.dismissIdleThought(t.id);
      }
      return prev.map((t) => (t.permanent ? t : { ...t, permanent: true }));
    });
    api.submit(text || 'What do you see?');
    setInput('');
    setAttachments([]);
    setPendingScreenshot(null);
    setSuggestions([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const startRecording = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mr.ondataavailable = (ev) => {
        if (ev.data?.size) recordedChunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        recordedChunksRef.current = [];
        setRecording(false);
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
        const b64 = btoa(bin);
        const text = await api.transcribe(b64, 'audio/webm');
        if (text) {
          setInput((v) => (v ? v + ' ' : '') + text);
          inputRef.current?.focus();
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (err) {
      console.warn('[merlin-panel] mic access failed', err);
      setRecording(false);
    }
  };
  const stopRecording = (): void => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
  };

  const captureScreen = async (): Promise<void> => {
    const res = await api.captureScreen();
    if (res?.ok) {
      const shot = await api.getPendingScreenshot();
      if (shot) setPendingScreenshot(shot);
    }
  };

  const clearScreenshot = async (): Promise<void> => {
    await api.clearScreenshot();
    setPendingScreenshot(null);
  };

  const renderMarkdown = (text: string): string => {
    try {
      return marked.parse(text, { async: false }) as string;
    } catch {
      return text;
    }
  };

  return (
    <div className="app">
      {/* The .panel is the visible dark surface — outer window is transparent
          so the .panel-tail can stick out past it toward Merlin. Same shape
          as the speech bubble, just bigger and themed dark. */}
      <div className="panel-tail" aria-hidden="true" />
      <div className="titlebar">
        <span className="titlebar-icon" title={character}>🧙</span>
        <h1>{character}</h1>
        <div className="spacer" />
        <button
          className="titlebar-btn"
          onClick={() => window.close()}
          title="Hide panel"
        >×</button>
      </div>

      <div className="thread" ref={threadRef}>
        {turns.length === 0 && !streaming && idleThoughts.length === 0 && (
          <div className="empty-state">
            No conversation yet. Type below or use the mic to start.
          </div>
        )}
        {/* Interleave turns + idle thoughts by timestamp so a thought stays
            anchored to the moment it was emitted, even after the user replies.
            Previously thoughts were rendered after the turns array (always at
            the bottom), so new replies would slot in ABOVE the thought.
            Last assistant turn is computed in advance because the merged
            order isn't a simple suffix on `turns` anymore. */}
        {(() => {
          type Item =
            | { kind: 'turn'; turn: PanelChatTurn; ts: number }
            | { kind: 'thought'; thought: PanelIdleThought; ts: number };
          const items: Item[] = [
            ...turns.map((t) => ({ kind: 'turn' as const, turn: t, ts: t.timestamp })),
            ...idleThoughts.map((th) => ({
              kind: 'thought' as const,
              thought: th,
              ts: th.emittedAt,
            })),
          ];
          items.sort((a, b) => a.ts - b.ts);
          const lastAssistantId = (() => {
            for (let i = turns.length - 1; i >= 0; i--) {
              const t = turns[i];
              if (t && t.role === 'assistant') return t.id;
            }
            return null;
          })();
          return items.map((item) => {
            if (item.kind === 'turn') {
              const t = item.turn;
              const isLastAssistant = t.id === lastAssistantId;
              return (
                <div key={t.id} className={`turn ${t.role}`}>
                  <div className="turn-header">
                    <span>{t.role === 'user' ? 'You' : character}</span>
                    {isLastAssistant && !t.streaming && (
                      <div className="turn-actions">
                        <button onClick={() => api.regenerate()} title="Regenerate response">
                          ↻ Regenerate
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="turn-content">
                    {t.streaming && !t.content ? (
                      <div className="typing-dots"><span /><span /><span /></div>
                    ) : (
                      <div
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(t.content) }}
                      />
                    )}
                  </div>
                </div>
              );
            }
            const thought = item.thought;
            const permanent = thought.permanent === true;
            const remaining = permanent
              ? 0
              : Math.max(
                  0,
                  Math.ceil((thought.emittedAt + thought.ttlMs - Date.now()) / 1000),
                );
            const totalSecs = Math.max(1, Math.round(thought.ttlMs / 1000));
            const pctRemaining = permanent
              ? 0
              : Math.max(0, Math.min(100, (remaining / totalSecs) * 100));
            return (
              <div
                key={thought.id}
                className={`turn idle-thought ${permanent ? 'permanent' : ''}`}
                onClick={permanent ? undefined : () => respondToIdleThought(thought)}
                title={permanent ? undefined : 'Click to reply, or wait for it to fade'}
              >
                <div className="turn-header">
                  <span>
                    💭 {character} {permanent ? '(thought)' : '(idle thought)'}
                  </span>
                  <div className="turn-actions">
                    {!permanent && (
                      <span className="idle-countdown" title={`${remaining} seconds until this fades`}>
                        ⏱ <span className="idle-countdown-num">{remaining}</span><span className="idle-countdown-unit">sec</span>
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dismissIdleThought(thought.id);
                      }}
                      title={permanent ? 'Remove' : 'Dismiss'}
                    >×</button>
                  </div>
                </div>
                <div className="turn-content">{thought.text}</div>
                {!permanent && (
                  <div
                    className="idle-progress"
                    style={{ width: `${pctRemaining}%` }}
                  />
                )}
              </div>
            );
          });
        })()}
      </div>

      {suggestions.length > 0 && !streaming && (
        <div className="suggestions">
          {suggestions.map((s, i) => (
            <button
              key={i}
              className="suggestion-chip"
              onClick={() => { api.submit(s); setSuggestions([]); }}
            >{s}</button>
          ))}
        </div>
      )}

      <div className="composer">
        <div className="attachments">
          {pendingScreenshot && (
            <span className="attachment-chip screenshot">
              📷 screenshot {pendingScreenshot.width}×{pendingScreenshot.height}
              {' '}({Math.round(pendingScreenshot.bytes / 1024)}KB)
              <button onClick={clearScreenshot} title="Discard">×</button>
            </span>
          )}
          {attachments.map((a, i) => (
            <span
              key={i}
              className={`attachment-chip ${a.error ? 'error' : ''}`}
              title={a.error || a.name}
            >
              {a.error ? `⚠ ${a.name}: ${a.error}` : `📎 ${a.name}`}
              <button
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                title="Remove"
              >×</button>
            </span>
          ))}
        </div>
        <div className="input-row">
          <button
            className={`icon-btn ${recording ? 'recording' : ''}`}
            onClick={() => recording ? stopRecording() : void startRecording()}
            title="Voice input (Whisper)"
          >🎙</button>
          <button
            className="icon-btn"
            onClick={() => void captureScreen()}
            title="Capture screen"
          >📷</button>
          <textarea
            ref={inputRef}
            value={input}
            placeholder="Ask Merlin... (Shift+Enter for newline)"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
          />
          {streaming || audioActive ? (
            // Stop button covers both states: cancels an in-flight LLM stream
            // AND any TTS audio that's still playing. api.stop() routes to
            // dismissBubble in main, which aborts the stream + cancelVoice.
            <button
              className="send-btn stop-btn"
              onClick={() => api.stop()}
              title={streaming ? 'Stop generating' : 'Stop voice'}
            >
              ■ {streaming ? 'Stop' : 'Mute'}
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={submit}
              disabled={!input.trim() && !pendingScreenshot && attachments.length === 0}
            >Ask</button>
          )}
        </div>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
