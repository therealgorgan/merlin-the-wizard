import { marked } from 'marked';

// Bubble renderer.

const textEl = document.getElementById('text') as HTMLDivElement | null;
const askRow = document.getElementById('ask-row') as HTMLDivElement | null;
const askInput = document.getElementById('ask-input') as HTMLInputElement | null;
const askSubmit = document.getElementById('ask-submit') as HTMLButtonElement | null;
const closeBtn = document.getElementById('close-btn') as HTMLButtonElement | null;
const suggestionsEl = document.getElementById('suggestions') as HTMLDivElement | null;
const micBtn = document.getElementById('mic-btn') as HTMLButtonElement | null;
const screenBtn = document.getElementById('screen-btn') as HTMLButtonElement | null;
const attachmentsStrip = document.getElementById('attachments-strip') as HTMLDivElement | null;

const api = window.bubbleApi;

if (!api) {
  console.error('[bubble] bubbleApi not exposed by preload');
}

marked.setOptions({ gfm: true, breaks: true });

// Accumulates the raw markdown text we've received so we can re-render it
// from scratch on each streaming chunk (markdown elements may span chunks).
let rawText = '';

function renderMarkdown(): void {
  if (!textEl) return;
  try {
    const html = marked.parse(rawText, { async: false }) as string;
    textEl.innerHTML = html;
  } catch {
    textEl.textContent = rawText;
  }
  textEl.scrollTop = textEl.scrollHeight;
}

function focusInputReliably(): void {
  if (!askInput) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      askInput.focus();
      askInput.select();
    });
  });
  setTimeout(() => {
    if (document.activeElement !== askInput) {
      askInput.focus();
      askInput.select();
    }
  }, 120);
}

function setMode(mode: 'read' | 'ask'): void {
  if (!askRow) return;
  if (mode === 'ask') {
    askRow.hidden = false;
    focusInputReliably();
  } else {
    askRow.hidden = true;
  }
}

function renderSuggestions(items: string[]): void {
  if (!suggestionsEl) return;
  suggestionsEl.innerHTML = '';
  if (items.length === 0) {
    suggestionsEl.hidden = true;
    return;
  }
  for (const text of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'suggestion-chip';
    btn.textContent = text;
    btn.addEventListener('click', () => {
      if (!api) return;
      api.submit(text);
      suggestionsEl.innerHTML = '';
      suggestionsEl.hidden = true;
    });
    suggestionsEl.appendChild(btn);
  }
  suggestionsEl.hidden = false;
}

const attachments: string[] = []; // local mirror for visual chips
let pendingScreenshot: { width: number; height: number; bytes: number } | null = null;

function renderAttachments(): void {
  if (!attachmentsStrip) return;
  attachmentsStrip.innerHTML = '';
  const empty = attachments.length === 0 && !pendingScreenshot;
  if (empty) {
    attachmentsStrip.hidden = true;
    return;
  }
  if (pendingScreenshot) {
    const chip = document.createElement('span');
    chip.className = 'attachment-chip screenshot';
    const kb = Math.round(pendingScreenshot.bytes / 1024);
    chip.innerHTML = `📷 screenshot ${pendingScreenshot.width}×${pendingScreenshot.height} (${kb}KB)`;
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.title = 'Discard screenshot';
    x.addEventListener('click', async () => {
      await api?.clearScreenshot();
      pendingScreenshot = null;
      renderAttachments();
    });
    chip.appendChild(x);
    attachmentsStrip.appendChild(chip);
  }
  for (const name of attachments) {
    const chip = document.createElement('span');
    chip.className = 'attachment-chip';
    chip.textContent = `📎 ${name}`;
    attachmentsStrip.appendChild(chip);
  }
  attachmentsStrip.hidden = false;
}

api?.onSetText(({ text, mode }) => {
  rawText = text;
  renderMarkdown();
  setMode(mode);
  if (suggestionsEl) {
    suggestionsEl.innerHTML = '';
    suggestionsEl.hidden = true;
  }
  if (mode === 'ask' && askInput) askInput.value = '';
  // Bubble was reset (new turn) — clear the local attachment chips too.
  attachments.length = 0;
  pendingScreenshot = null;
  renderAttachments();
  // Re-sync screenshot state from main on every bubble reset.
  void (async () => {
    pendingScreenshot = (await api?.getPendingScreenshot?.()) ?? null;
    renderAttachments();
  })();
});

api?.onScreenshotReady?.((meta) => {
  pendingScreenshot = meta;
  renderAttachments();
});

api?.onAppendText((chunk) => {
  rawText += chunk;
  renderMarkdown();
});

api?.onSetMode((mode) => {
  setMode(mode);
});

api?.onSetSuggestions((items) => {
  renderSuggestions(items);
});

api?.onSetTailSide((side) => {
  document.body.dataset.tail = side;
});

function submit(): void {
  if (!askInput || !api) return;
  const v = askInput.value.trim();
  if (!v && !pendingScreenshot) return;
  api.submit(v || 'What do you see?');
  askInput.value = '';
  attachments.length = 0;
  pendingScreenshot = null;
  renderAttachments();
}

askSubmit?.addEventListener('click', submit);
askInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submit();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    api?.dismiss();
  }
});

closeBtn?.addEventListener('click', () => api?.dismiss());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api?.dismiss();
});

// --- Drag and drop files ---

function showDropError(msg: string): void {
  if (!attachmentsStrip) return;
  const chip = document.createElement('span');
  chip.className = 'attachment-chip error';
  chip.textContent = `⚠ ${msg}`;
  attachmentsStrip.appendChild(chip);
  attachmentsStrip.hidden = false;
  setTimeout(() => {
    chip.remove();
    if (attachmentsStrip.childElementCount === 0) attachmentsStrip.hidden = true;
  }, 4000);
}

let dragDepth = 0;
document.body.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  document.body.classList.add('drop-target');
});
document.body.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth--;
  if (dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove('drop-target');
  }
});
document.body.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});
document.body.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('drop-target');
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  for (const f of Array.from(files)) {
    const result = await api?.attachDroppedFile(f);
    if (result?.ok && result.name) {
      attachments.push(result.name);
    } else if (result && !result.ok) {
      showDropError(`${f.name}: ${result.error ?? 'rejected'}`);
    }
  }
  renderAttachments();
});

// --- Voice input via Whisper ---

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];

async function startRecording(): Promise<void> {
  if (!micBtn) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) recordedChunks.push(ev.data);
    };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      recordedChunks = [];
      micBtn.classList.remove('recording');
      micBtn.textContent = '⏳';
      try {
        const base64 = await blobToBase64(blob);
        const text = await api?.transcribe(base64, 'audio/webm');
        if (text && askInput) {
          askInput.value = text;
          askInput.focus();
        }
      } finally {
        micBtn.textContent = '🎙';
      }
    };
    mediaRecorder.start();
    micBtn.classList.add('recording');
    micBtn.textContent = '⏺';
  } catch (err) {
    console.warn('[bubble] mic access failed', err);
    micBtn.textContent = '🚫';
    setTimeout(() => {
      if (micBtn) micBtn.textContent = '🎙';
    }, 1500);
  }
}

function stopRecording(): void {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder = null;
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

micBtn?.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
  } else {
    void startRecording();
  }
});

screenBtn?.addEventListener('click', async () => {
  if (!screenBtn || !api) return;
  screenBtn.disabled = true;
  screenBtn.textContent = '⏳';
  try {
    const res = await api.captureScreen();
    if (res?.ok) {
      pendingScreenshot = {
        width: res.width ?? 0, height: res.height ?? 0, bytes: 0,
      };
      // Pull true byte count from main.
      pendingScreenshot = (await api.getPendingScreenshot()) ?? pendingScreenshot;
      renderAttachments();
    }
  } finally {
    screenBtn.textContent = '📷';
    screenBtn.disabled = false;
  }
});
