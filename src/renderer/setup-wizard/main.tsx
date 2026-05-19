import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  SetupWizardApi,
  StoreSnapshot,
  ProviderInfoForUi,
  CharacterForUi,
} from '@shared/ipc-contract';

declare global {
  interface Window {
    setupWizardApi?: SetupWizardApi;
  }
}

const api = window.setupWizardApi!;

type StepId =
  | 'welcome'
  | 'name'
  | 'character'
  | 'chat-llm'
  | 'voice'
  | 'chat-style'
  | 'done';

interface StepInfo {
  id: StepId;
  label: string;
}

const STEPS: ReadonlyArray<StepInfo> = [
  { id: 'welcome',    label: 'Welcome' },
  { id: 'name',       label: 'Your name' },
  { id: 'character',  label: 'Character' },
  { id: 'chat-llm',   label: 'Chat LLM' },
  { id: 'voice',      label: 'Voice' },
  { id: 'chat-style', label: 'Chat style' },
  { id: 'done',       label: 'Done' },
];

const VOICE_ENGINES = [
  {
    id: 'edge',
    label: 'Microsoft Edge Neural',
    desc: 'Free, online, no API key. Sounds great. Default voice: Aria.',
    recommended: true,
  },
  {
    id: 'sapi',
    label: 'Windows SAPI (offline)',
    desc: 'Uses voices already installed on Windows (David, Zira, Hazel). No internet needed but voices sound dated.',
  },
  {
    id: 'groq',
    label: 'Groq Orpheus (cloud)',
    desc: 'High quality, uses your Groq API key. Pick this if you set up Groq above.',
  },
  {
    id: 'off',
    label: 'No voice (text only)',
    desc: 'Merlin replies in text. Quiet, simple, no setup.',
  },
];

function StepPills(props: { current: StepId }): React.ReactElement {
  const idx = STEPS.findIndex((s) => s.id === props.current);
  return (
    <div className="step-pill-row">
      {STEPS.map((s, i) => {
        const cls = i === idx ? 'active' : i < idx ? 'done' : '';
        return (
          <span className={`step-pill ${cls}`} key={s.id}>
            {s.label}
          </span>
        );
      })}
    </div>
  );
}

function App(): React.ReactElement {
  const [step, setStep] = useState<StepId>('welcome');
  const [snapshot, setSnapshot] = useState<StoreSnapshot | null>(null);
  const [providers, setProviders] = useState<ProviderInfoForUi[]>([]);
  const [characters, setCharacters] = useState<CharacterForUi[]>([]);

  // Per-step working state.
  const [userName, setUserName] = useState('');
  const [characterId, setCharacterId] = useState('Merlin');
  const [providerId, setProviderId] = useState<string>('groq');
  const [providerModel, setProviderModel] = useState('');
  const [providerKey, setProviderKey] = useState('');
  const [keySaving, setKeySaving] = useState(false);
  const [keyStatus, setKeyStatus] = useState<string>('');
  const [voiceEngine, setVoiceEngine] = useState('edge');
  const [chatStyle, setChatStyle] = useState<'classic' | 'modern'>('classic');
  const [finishing, setFinishing] = useState(false);

  // Pre-fill from current store on mount so re-running the wizard doesn't
  // wipe existing config.
  useEffect(() => {
    void (async () => {
      try {
        const [snap, provs, chars] = await Promise.all([
          api.getSnapshot(),
          api.getProviders(),
          api.getCharacters(),
        ]);
        setSnapshot(snap);
        setProviders(provs);
        setCharacters(chars);
        setUserName(snap.userName ?? '');
        if (snap.character) setCharacterId(snap.character);
        if (snap.llmProvider) setProviderId(snap.llmProvider);
        if (snap.llmModel) setProviderModel(snap.llmModel);
        if (snap.voiceEngine) setVoiceEngine(snap.voiceEngine);
        if (snap.displayMode) setChatStyle(snap.displayMode);
      } catch {
        // best-effort prefill
      }
    })();
  }, []);

  // Sync providerModel to the chosen provider's default when the user
  // switches provider (unless they've explicitly typed something).
  useEffect(() => {
    const info = providers.find((p) => p.id === providerId);
    if (info && (!providerModel || providers.some((p) => p.defaultModel === providerModel))) {
      setProviderModel(info.defaultModel);
    }
  }, [providerId, providers]);

  async function saveProviderKey(): Promise<void> {
    const info = providers.find((p) => p.id === providerId);
    if (!info || !info.needsApiKey || !info.secretName) return;
    if (!providerKey.trim()) {
      setKeyStatus('Paste your API key first.');
      return;
    }
    setKeySaving(true);
    setKeyStatus('Saving...');
    try {
      await api.setSecret(info.secretName, providerKey.trim());
      setKeyStatus('✓ Key saved (encrypted on this machine).');
      setProviderKey('');
    } catch (err) {
      setKeyStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setKeySaving(false);
    }
  }

  async function finishAndClose(launchBrain: boolean): Promise<void> {
    setFinishing(true);
    try {
      // Patch only the fields the user touched. Skips empty userName so the
      // Windows username still gets used as a fallback.
      const patch: Partial<StoreSnapshot> = {
        llmProvider: providerId,
        llmModel: providerModel,
        voiceEngine: voiceEngine,
        displayMode: chatStyle,
        character: characterId,
        userName: userName.trim() || null,
      };
      await api.set(patch);
      await api.complete();
      if (launchBrain) {
        await api.openBrainWizard();
      }
      api.close();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setFinishing(false);
    }
  }

  // ── Per-step renderers ─────────────────────────────────────────────────

  function renderWelcome(): React.ReactElement {
    return (
      <>
        <div className="welcome-hero">
          <div className="emoji" aria-hidden="true">🧙</div>
          <h1>Welcome to Merlin the Wizard</h1>
          <div className="sub">
            A desktop companion that recreates the Microsoft Agent Merlin
            sprite as a modern LLM-backed assistant.
          </div>
        </div>
        <p>
          This setup takes about <strong>2 minutes</strong>. We'll walk through:
        </p>
        <ul style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
          <li>Your name (what Merlin calls you)</li>
          <li>Pick a character (Merlin / Genie / Robby / Links / ...)</li>
          <li>Pick a chat LLM (Groq is free + fast — recommended)</li>
          <li>Pick a voice (or skip)</li>
          <li>Classic bubble or modern panel</li>
        </ul>
        <p className="muted">
          You can change anything later from <strong>Settings</strong>. Click{' '}
          <strong>Skip</strong> on any step to keep its current value.
        </p>
      </>
    );
  }

  function renderName(): React.ReactElement {
    return (
      <>
        <h2>What should Merlin call you?</h2>
        <p className="muted">
          Optional. Leave blank to use your Windows account name.
        </p>
        <div className="field-row">
          <label htmlFor="username">Your name</label>
          <input
            id="username"
            type="text"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="(e.g. Alex)"
            autoFocus
          />
        </div>
      </>
    );
  }

  function renderCharacter(): React.ReactElement {
    return (
      <>
        <h2>Pick a character</h2>
        <p className="muted">
          The sprite Merlin uses. You can swap any time from the tray menu's{' '}
          <code>Customize → Character</code>.
        </p>
        {characters.map((c) => (
          <div
            key={c.id}
            className={`option-card ${characterId === c.id ? 'active' : ''}`}
            onClick={() => setCharacterId(c.id)}
          >
            <div className="title">
              <input
                type="radio"
                name="character"
                checked={characterId === c.id}
                onChange={() => setCharacterId(c.id)}
              />
              {c.displayName}
              {c.custom ? <span className="badge info">Custom</span> : null}
              {c.id === 'Merlin' ? <span className="badge rec">Default</span> : null}
            </div>
            <div className="desc">{c.description}</div>
          </div>
        ))}
      </>
    );
  }

  function renderChatLlm(): React.ReactElement {
    const info = providers.find((p) => p.id === providerId);
    return (
      <>
        <h2>Pick a Chat LLM</h2>
        <p className="muted">
          The model that answers when you chat with Merlin. <strong>Groq</strong>{' '}
          has a generous free tier and is the fastest cloud option —{' '}
          <button
            className="link"
            onClick={() => void api.openExternal('https://console.groq.com/keys')}
          >
            grab a free key here
          </button>
          .
        </p>
        {providers.map((p) => (
          <div
            key={p.id}
            className={`option-card ${providerId === p.id ? 'active' : ''}`}
            onClick={() => setProviderId(p.id)}
          >
            <div className="title">
              <input
                type="radio"
                name="provider"
                checked={providerId === p.id}
                onChange={() => setProviderId(p.id)}
              />
              {p.displayName}
              {p.id === 'groq' ? <span className="badge rec">Recommended</span> : null}
              {!p.needsApiKey ? <span className="badge info">Local</span> : null}
            </div>
            <div className="desc">
              Default model: <code>{p.defaultModel}</code>
              {p.needsApiKey ? ' — needs an API key.' : ' — no key required.'}
            </div>
          </div>
        ))}
        {info && info.needsApiKey ? (
          <div style={{ marginTop: 14 }}>
            <div className="field-row">
              <label htmlFor="api-key">{info.displayName} API key</label>
              <input
                id="api-key"
                type="password"
                value={providerKey}
                onChange={(e) => setProviderKey(e.target.value)}
                placeholder={`Paste your ${info.displayName} key`}
              />
            </div>
            <div className="flex-row">
              <button
                className="primary"
                disabled={keySaving || !providerKey.trim()}
                onClick={() => void saveProviderKey()}
              >
                {keySaving ? 'Saving…' : 'Save key'}
              </button>
              {info.keyHelpUrl ? (
                <button
                  className="link"
                  onClick={() => void api.openExternal(info.keyHelpUrl ?? '')}
                >
                  Get a key →
                </button>
              ) : null}
              {keyStatus ? (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{keyStatus}</span>
              ) : null}
            </div>
            <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              Keys are encrypted on this machine (Windows DPAPI) and never
              leave it. You can also paste a key later from <strong>Settings → Chat</strong>.
            </p>
          </div>
        ) : info && info.id === 'ollama' ? (
          <div className="alert info" style={{ marginTop: 14 }}>
            Ollama runs locally — no key needed. Make sure the Ollama desktop
            app is installed and running at <code>http://localhost:11434</code>.
            Use the <strong>Brain Setup Wizard</strong> at the end of this flow
            for a guided install.
          </div>
        ) : null}
      </>
    );
  }

  function renderVoice(): React.ReactElement {
    return (
      <>
        <h2>Pick a voice engine</h2>
        <p className="muted">
          How Merlin speaks his replies. Edge Neural is free and sounds great —
          recommended unless you want fully offline.
        </p>
        {VOICE_ENGINES.map((v) => (
          <div
            key={v.id}
            className={`option-card ${voiceEngine === v.id ? 'active' : ''}`}
            onClick={() => setVoiceEngine(v.id)}
          >
            <div className="title">
              <input
                type="radio"
                name="voice"
                checked={voiceEngine === v.id}
                onChange={() => setVoiceEngine(v.id)}
              />
              {v.label}
              {v.recommended ? <span className="badge rec">Recommended</span> : null}
            </div>
            <div className="desc">{v.desc}</div>
          </div>
        ))}
      </>
    );
  }

  function renderChatStyle(): React.ReactElement {
    return (
      <>
        <h2>Pick a chat style</h2>
        <p className="muted">
          How chat with Merlin is presented. You can switch any time from the
          tray menu's <code>Customize → Chat Style</code>.
        </p>
        <div
          className={`option-card ${chatStyle === 'classic' ? 'active' : ''}`}
          onClick={() => setChatStyle('classic')}
        >
          <div className="title">
            <input
              type="radio"
              name="style"
              checked={chatStyle === 'classic'}
              onChange={() => setChatStyle('classic')}
            />
            Classic — floating sprite + speech bubble
            <span className="badge rec">Nostalgic</span>
          </div>
          <div className="desc">
            The original Microsoft Agent vibe. A tiny transparent Merlin
            sprite and a yellow speech bubble that pops up beside him when
            he replies.
          </div>
        </div>
        <div
          className={`option-card ${chatStyle === 'modern' ? 'active' : ''}`}
          onClick={() => setChatStyle('modern')}
        >
          <div className="title">
            <input
              type="radio"
              name="style"
              checked={chatStyle === 'modern'}
              onChange={() => setChatStyle('modern')}
            />
            Modern — floating sprite + docked chat panel
            <span className="badge info">Full thread</span>
          </div>
          <div className="desc">
            Sprite stays floating; chat happens in a panel docked alongside
            him with the full conversation history, multi-line input,
            inline attachment previews, and per-turn regenerate.
          </div>
        </div>
      </>
    );
  }

  function renderDone(): React.ReactElement {
    const info = providers.find((p) => p.id === providerId);
    return (
      <>
        <h2>All set</h2>
        <div className="alert ok">
          ✓ Merlin is ready. You can change anything in <strong>Settings</strong>{' '}
          (right-click Merlin → Settings).
        </div>
        <p className="muted">
          Your setup:
        </p>
        <ul style={{ color: 'var(--muted)', lineHeight: 1.7, fontSize: 13 }}>
          <li>Name: <strong>{userName.trim() || '(Windows username)'}</strong></li>
          <li>Character: <strong>{characterId}</strong></li>
          <li>Chat LLM: <strong>{info?.displayName ?? providerId}</strong> · <code>{providerModel}</code></li>
          <li>Voice: <strong>{VOICE_ENGINES.find((v) => v.id === voiceEngine)?.label ?? voiceEngine}</strong></li>
          <li>Chat style: <strong>{chatStyle === 'modern' ? 'Modern (docked panel)' : 'Classic (speech bubble)'}</strong></li>
        </ul>
        <div
          style={{
            marginTop: 18,
            padding: 14,
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 8,
          }}
        >
          <strong>Want Merlin to think autonomously?</strong>
          <div className="muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 10 }}>
            The Brain Setup Wizard walks you through installing Ollama and
            picking a tiny local model so Merlin can emit idle thoughts,
            wander, and gesture on his own every few minutes. Optional and
            entirely free.
          </div>
          <button
            className="primary"
            disabled={finishing}
            onClick={() => void finishAndClose(true)}
          >
            🧙 Finish &amp; open Brain Setup Wizard →
          </button>
        </div>
      </>
    );
  }

  // ── Footer nav helpers ─────────────────────────────────────────────────

  function canAdvance(): boolean {
    if (step === 'chat-llm') {
      // The only required step. Block "Next" if no provider is selected.
      // Key entry is optional here — user can skip and configure later.
      return Boolean(providerId);
    }
    return true;
  }

  function next(): void {
    const idx = STEPS.findIndex((s) => s.id === step);
    const nextStep = STEPS[idx + 1];
    if (nextStep) setStep(nextStep.id);
  }

  function back(): void {
    const idx = STEPS.findIndex((s) => s.id === step);
    const prev = STEPS[idx - 1];
    if (prev) setStep(prev.id);
  }

  if (!snapshot) {
    return (
      <>
        <header>
          <h1>Welcome to Merlin</h1>
        </header>
        <main>
          <p>Loading…</p>
        </main>
      </>
    );
  }

  const isDone = step === 'done';
  const isFirstStep = step === 'welcome';

  return (
    <>
      <header>
        <h1>🧙 First-Time Setup</h1>
        <div className="subtitle">
          About 2 minutes. You can skip any step.
        </div>
      </header>
      <main>
        <StepPills current={step} />
        {step === 'welcome' && renderWelcome()}
        {step === 'name' && renderName()}
        {step === 'character' && renderCharacter()}
        {step === 'chat-llm' && renderChatLlm()}
        {step === 'voice' && renderVoice()}
        {step === 'chat-style' && renderChatStyle()}
        {step === 'done' && renderDone()}
      </main>
      <footer>
        {!isFirstStep ? (
          <button onClick={back} disabled={finishing}>← Back</button>
        ) : (
          <span />
        )}
        <span className="spacer" />
        <button
          onClick={() => void finishAndClose(false)}
          disabled={finishing}
          title="Skip the rest and finish with current values"
        >
          {isDone ? 'Finish' : 'Skip & finish'}
        </button>
        {!isDone ? (
          <button className="primary" disabled={!canAdvance()} onClick={next}>
            Next →
          </button>
        ) : null}
      </footer>
    </>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
