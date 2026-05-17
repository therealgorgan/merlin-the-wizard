import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { marked } from 'marked';
import type { PanelChatTurn } from '@shared/ipc-contract';

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
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

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
    return () => { offUser(); offChunk(); offStreaming(); offFinal(); offSug(); offOpen(); };
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
        {turns.length === 0 && !streaming && (
          <div className="empty-state">
            No conversation yet. Type below or use the mic to start.
          </div>
        )}
        {turns.map((t, i) => {
          const isLastAssistant = t.role === 'assistant' && i === turns.length - 1;
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
        })}
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
          {streaming ? (
            <button
              className="send-btn stop-btn"
              onClick={() => api.stop()}
              title="Stop"
            >■ Stop</button>
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
