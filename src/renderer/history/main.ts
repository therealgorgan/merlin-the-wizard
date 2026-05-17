export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

declare global {
  interface Window {
    historyApi?: { getHistory: () => Promise<ChatTurn[]> };
  }
}

const messagesEl = document.getElementById('messages')!;
const filterEl = document.getElementById('filter') as HTMLInputElement;
const countEl = document.getElementById('count')!;

let allTurns: ChatTurn[] = [];

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function render(): void {
  const q = filterEl.value.trim().toLowerCase();
  const filtered = q
    ? allTurns.filter((t) => t.content.toLowerCase().includes(q))
    : allTurns;

  messagesEl.innerHTML = '';
  if (filtered.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = q
      ? `No messages match "${q}".`
      : 'No conversation yet. Ask Merlin something!';
    messagesEl.appendChild(p);
    countEl.textContent = '';
    return;
  }

  countEl.textContent = `${filtered.length} message${filtered.length === 1 ? '' : 's'}`;

  for (const turn of filtered) {
    const div = document.createElement('div');
    div.className = `turn ${turn.role}`;
    const header = document.createElement('div');
    header.className = 'turn-header';
    header.textContent = `${turn.role === 'user' ? 'You' : 'Merlin'} · ${fmtTime(turn.timestamp)}`;
    const body = document.createElement('div');
    body.className = 'turn-content';
    body.textContent = turn.content;
    div.appendChild(header);
    div.appendChild(body);
    messagesEl.appendChild(div);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

filterEl.addEventListener('input', render);

void (async () => {
  if (!window.historyApi) {
    messagesEl.innerHTML = '<p class="empty">historyApi not exposed</p>';
    return;
  }
  allTurns = await window.historyApi.getHistory();
  render();
})();
