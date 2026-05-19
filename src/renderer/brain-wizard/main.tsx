import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  BrainWizardApi,
  HardwareInfo,
  OllamaProbeResult,
  OllamaPullProgress,
  OllamaScanResult,
} from '@shared/ipc-contract';
import {
  BRAIN_MODEL_CATALOG,
  recommendedTag as catalogRecommendedTag,
} from '@shared/brain-models-catalog';

declare global {
  interface Window {
    brainWizardApi?: BrainWizardApi;
  }
}

const api = window.brainWizardApi!;

type ControllerChoice = 'default' | 'local-llm' | 'hermes';

// Model catalog now lives in src/shared/brain-models-catalog.ts so the wizard
// and Settings → Brain stay in sync. Local alias keeps the existing code below
// untouched.
const MODEL_OPTIONS = BRAIN_MODEL_CATALOG;
const recommendedTag = catalogRecommendedTag;

function bytesToHuman(n: number | undefined): string {
  if (!n || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

type WizardStep =
  | 'intro'
  | 'ollama-probe'
  | 'ollama-missing'
  | 'pick-model'
  | 'pulling'
  | 'testing'
  | 'done'
  | 'hermes-config'
  | 'hermes-test';

function StepPills(props: { step: WizardStep; choice: ControllerChoice }): React.ReactElement {
  const { step, choice } = props;
  const localSteps: Array<{ key: WizardStep; label: string }> = [
    { key: 'intro', label: 'Choose' },
    { key: 'ollama-probe', label: 'Check Ollama' },
    { key: 'pick-model', label: 'Pick model' },
    { key: 'pulling', label: 'Install' },
    { key: 'testing', label: 'Verify' },
    { key: 'done', label: 'Apply' },
  ];
  const hermesSteps: Array<{ key: WizardStep; label: string }> = [
    { key: 'intro', label: 'Choose' },
    { key: 'hermes-config', label: 'Configure' },
    { key: 'hermes-test', label: 'Verify' },
    { key: 'done', label: 'Apply' },
  ];
  const defaultSteps: Array<{ key: WizardStep; label: string }> = [
    { key: 'intro', label: 'Choose' },
    { key: 'done', label: 'Apply' },
  ];
  const steps =
    choice === 'local-llm' ? localSteps : choice === 'hermes' ? hermesSteps : defaultSteps;

  const reached = steps.findIndex((s) => s.key === step);
  return (
    <div className="step-pill-row">
      {steps.map((s, i) => {
        const cls =
          i === reached ? 'active' : i < reached || step === 'done' ? 'done' : '';
        return (
          <span className={`step-pill ${cls}`} key={s.key}>
            {s.label}
          </span>
        );
      })}
    </div>
  );
}

function App(): React.ReactElement {
  const [step, setStep] = useState<WizardStep>('intro');
  const [choice, setChoice] = useState<ControllerChoice>('local-llm');
  const [hw, setHw] = useState<HardwareInfo | null>(null);

  const [ollamaEndpoint, setOllamaEndpoint] = useState('http://localhost:11434/api');
  const [ollamaProbe, setOllamaProbe] = useState<OllamaProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [scanResult, setScanResult] = useState<OllamaScanResult | null>(null);
  const [scanning, setScanning] = useState(false);

  const [pickedModel, setPickedModel] = useState<string>('llama3.2:3b');
  const [customModel, setCustomModel] = useState('');
  const [pullId, setPullId] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<OllamaPullProgress | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);

  const [testing, setTesting] = useState(false);
  const [testReply, setTestReply] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const [hermesEndpoint, setHermesEndpoint] = useState('');
  const [hermesKey, setHermesKey] = useState('');
  const [hermesModel, setHermesModel] = useState('hermes-agent');
  const [hermesProbe, setHermesProbe] = useState<{
    ok: boolean;
    models: string[];
    profiles: Array<{ name: string; url: string }>;
    error?: string;
  } | null>(null);
  const [hermesProbing, setHermesProbing] = useState(false);
  const [hermesKeySaved, setHermesKeySaved] = useState(false);

  // Opt-in: also use the picked Ollama model as the Conversational/Chat LLM.
  // Default false — chat config shouldn't change unless the user asks for it.
  const [mirrorToChat, setMirrorToChat] = useState(false);

  // Pre-fill from current store snapshot once on mount.
  useEffect(() => {
    void (async () => {
      try {
        const snap = await api.getSnapshot();
        if (snap.ollamaEndpoint) setOllamaEndpoint(snap.ollamaEndpoint);
        if (snap.hermesEndpoint) setHermesEndpoint(snap.hermesEndpoint);
        const keySaved = await api.hasSecret('hermes_api_key');
        setHermesKeySaved(keySaved);
        if (snap.brainController === 'hermes') setChoice('hermes');
        else if (snap.brainController === 'local-llm') setChoice('local-llm');
      } catch {
        // best-effort
      }
    })();
  }, []);

  // Subscribe to pull-progress events.
  useEffect(() => {
    const off = api.onPullProgress((ev) => {
      // Match by pullId so stale streams from cancelled pulls don't override
      // the current one.
      if (pullId && ev.pullId !== pullId) return;
      setPullProgress(ev);
      if (ev.done === 'done') {
        // Auto-advance to test step.
        setStep('testing');
      } else if (ev.done === 'error') {
        setPullError(ev.error ?? 'Pull failed');
      }
    });
    return off;
  }, [pullId]);

  // Detect hardware once when entering the local-llm flow.
  useEffect(() => {
    if (choice !== 'local-llm') return;
    if (hw) return;
    void (async () => {
      try {
        const info = await api.detectHardware();
        setHw(info);
        setPickedModel(recommendedTag(info.totalRamGb, info.gpus.length > 0));
      } catch {
        // best-effort
      }
    })();
  }, [choice, hw]);

  // Run test step after pull finishes.
  useEffect(() => {
    if (step !== 'testing') return;
    void (async () => {
      setTesting(true);
      setTestError(null);
      setTestReply(null);
      try {
        const res = await api.testOllamaModel(
          customModel.trim() || pickedModel,
          ollamaEndpoint,
        );
        if (res.ok) setTestReply(res.reply ?? '(empty reply)');
        else setTestError(res.error ?? 'Test failed');
      } catch (err) {
        setTestError(err instanceof Error ? err.message : String(err));
      } finally {
        setTesting(false);
      }
    })();
  }, [step]);

  const ramGb = hw?.totalRamGb ?? 0;
  const hasGpu = (hw?.gpus.length ?? 0) > 0;
  const recommended = useMemo(() => recommendedTag(ramGb, hasGpu), [ramGb, hasGpu]);

  // ── Step renderers ────────────────────────────────────────────────────────

  function renderIntro(): React.ReactElement {
    return (
      <>
        <h2>Pick Merlin's brain</h2>
        <p>
          Merlin's brain decides what he does when you're not actively chatting —
          when to wander, when to muse, when to look around. Pick how that brain
          should work:
        </p>
        <div
          className={`controller-card ${choice === 'default' ? 'active' : ''}`}
          onClick={() => setChoice('default')}
        >
          <div className="title">
            <input
              type="radio"
              name="ctrl"
              checked={choice === 'default'}
              onChange={() => setChoice('default')}
            />
            Default (timer-based)
          </div>
          <div className="desc">
            The original autonomous loop — a simple 60-second timer with curated
            idle thoughts. No external dependencies, no per-tick cost. Works
            offline. This is what you've been using.
          </div>
        </div>
        <div
          className={`controller-card ${choice === 'local-llm' ? 'active' : ''}`}
          onClick={() => setChoice('local-llm')}
        >
          <div className="title">
            <input
              type="radio"
              name="ctrl"
              checked={choice === 'local-llm'}
              onChange={() => setChoice('local-llm')}
            />
            Local LLM (Ollama) <span className="badge rec">Recommended</span>
          </div>
          <div className="desc">
            A small language model running on your own computer (via Ollama)
            decides what Merlin does at each idle tick. Free, private, works
            offline once installed. We'll help you pick a model and pull it.
          </div>
        </div>
        <div
          className={`controller-card ${choice === 'hermes' ? 'active' : ''}`}
          onClick={() => setChoice('hermes')}
        >
          <div className="title">
            <input
              type="radio"
              name="ctrl"
              checked={choice === 'hermes'}
              onChange={() => setChoice('hermes')}
            />
            Hermes Agent (self-hosted)
          </div>
          <div className="desc">
            Point Merlin's brain at a Hermes Agent profile you (or someone you
            trust) hosts. Uses the OpenAI-compatible API. For users already
            running Hermes — picks up your existing profile.
          </div>
        </div>
      </>
    );
  }

  async function startOllamaProbe(): Promise<void> {
    setProbing(true);
    try {
      const res = await api.probeOllama(ollamaEndpoint);
      setOllamaProbe(res);
      if (!res.reachable) setStep('ollama-missing');
      else setStep('pick-model');
    } finally {
      setProbing(false);
    }
  }

  async function startOllamaScan(): Promise<void> {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await api.scanForOllama();
      setScanResult(res);
      if (res.detected) {
        // Found it. Pin the endpoint and pull installed-models from the same
        // result so we don't waste another HTTP roundtrip.
        const url = res.detected.url;
        setOllamaEndpoint(`${url.replace(/\/+$/, '')}/api`);
        setOllamaProbe({
          reachable: true,
          installedModels: res.detected.installedModels,
          ...(res.detected.version ? { version: res.detected.version } : {}),
        });
      } else {
        setOllamaProbe({
          reachable: false,
          installedModels: [],
          error: 'No responder among the scanned endpoints.',
        });
      }
    } finally {
      setScanning(false);
    }
  }

  function sourceLabel(s: string): string {
    switch (s) {
      case 'stored': return 'your saved endpoint';
      case 'env': return 'OLLAMA_HOST env var';
      case 'localhost': return 'localhost:11434 (default)';
      case 'loopback': return '127.0.0.1:11434 (default)';
      case 'all-interfaces': return '0.0.0.0:11434 (all interfaces)';
      case 'process': return 'running ollama process';
      case 'alt-port': return 'alt port 11435';
      default: return s;
    }
  }

  function renderOllamaProbe(): React.ReactElement {
    return (
      <>
        <h2>Finding Ollama</h2>
        <p className="muted">
          Scanning common Ollama locations and inspecting any running{' '}
          <code>ollama.exe</code> on this machine. Should take a few seconds.
        </p>

        {scanning ? (
          <div className="progress-shell">
            <div className="progress-line">⏳ Scanning endpoints in parallel…</div>
          </div>
        ) : null}

        {!scanning && scanResult ? (
          scanResult.detected ? (
            <>
              <div className="alert ok">
                ✓ Found Ollama at <code>{scanResult.detected.url}</code>
                {scanResult.detected.version
                  ? ` (v${scanResult.detected.version})`
                  : ''}
                .{' '}
                {scanResult.detected.installedModels.length === 0
                  ? 'No models installed yet — we\'ll pick one in a moment.'
                  : `${scanResult.detected.installedModels.length} model(s) already installed.`}
              </div>
              {scanResult.processInfo ? (
                <p className="muted" style={{ fontSize: 12 }}>
                  Running process PID <code>{scanResult.processInfo.pid}</code>{' '}
                  bound to <code>{scanResult.processInfo.localAddress}:{scanResult.processInfo.port}</code>.
                </p>
              ) : null}
              {scanResult.ollamaHostEnv ? (
                <p className="muted" style={{ fontSize: 12 }}>
                  OLLAMA_HOST env var: <code>{scanResult.ollamaHostEnv}</code>
                </p>
              ) : null}
            </>
          ) : (
            <div className="alert warn">
              No Ollama instance responded to any of the scanned endpoints.
              {scanResult.processInfo ? (
                <>
                  {' '}But a <code>ollama.exe</code> process is running at{' '}
                  <code>{scanResult.processInfo.localAddress}:{scanResult.processInfo.port}</code> —
                  it might be a firewall issue. Try opening that URL in a browser
                  to confirm.
                </>
              ) : null}
            </div>
          )
        ) : null}

        {!scanning && scanResult ? (
          <details style={{ marginBottom: 14, fontSize: 12, color: 'var(--muted)' }}>
            <summary style={{ cursor: 'pointer' }}>
              Show all {scanResult.attempted.length} probe attempts
            </summary>
            <div style={{ marginTop: 8 }}>
              {scanResult.attempted.map((a) => (
                <div key={`${a.url}-${a.source}`} style={{ fontFamily: "'Cascadia Mono', Consolas, monospace" }}>
                  {a.ok ? '✓' : '✗'} <code>{a.url}</code> — {sourceLabel(a.source)}
                  {a.error ? ` (${a.error})` : ''}
                </div>
              ))}
            </div>
          </details>
        ) : null}

        <div className="field-row">
          <label htmlFor="oll-endpoint">Or point Merlin at a specific endpoint</label>
          <input
            id="oll-endpoint"
            type="text"
            value={ollamaEndpoint}
            onChange={(e) => setOllamaEndpoint(e.target.value)}
            placeholder="http://localhost:11434/api"
          />
        </div>
        <div className="flex-row">
          <button
            disabled={scanning || probing}
            onClick={() => void startOllamaScan()}
          >
            {scanning ? 'Scanning…' : '↻ Auto-detect again'}
          </button>
          <button
            className="primary"
            disabled={probing || scanning}
            onClick={() => void startOllamaProbe()}
          >
            {probing ? 'Probing…' : 'Test this endpoint'}
          </button>
        </div>
      </>
    );
  }

  function renderOllamaMissing(): React.ReactElement {
    return (
      <>
        <h2>Ollama not detected</h2>
        <div className="alert warn">
          We couldn't reach Ollama at <code>{ollamaEndpoint}</code>.
          {ollamaProbe?.error ? (
            <>
              {' '}Error: <code>{ollamaProbe.error}</code>
            </>
          ) : null}
        </div>
        <p>
          If you haven't installed Ollama yet, download the official Windows
          installer from <code>ollama.com/download</code>. It's a single .exe;
          run it and Ollama starts as a background service automatically. Come
          back here and click "Re-check" once it's running.
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          If you have it installed but it's on a custom port, run{' '}
          <code>echo %OLLAMA_HOST%</code> in Command Prompt — that's the value
          Ollama is listening on. Or check Task Manager for the{' '}
          <code>ollama.exe</code> process and look at its open ports.
        </p>
        <div className="flex-row">
          <button
            className="primary"
            onClick={() => void api.openExternal('https://ollama.com/download')}
          >
            Open Ollama download page →
          </button>
          <button onClick={() => void startOllamaScan()} disabled={scanning}>
            {scanning ? 'Re-scanning…' : '↻ Re-scan all endpoints'}
          </button>
          <button onClick={() => void startOllamaProbe()} disabled={probing}>
            {probing ? 'Re-checking…' : 'Test endpoint above'}
          </button>
        </div>
        {scanResult ? (
          <details style={{ marginTop: 14, fontSize: 12, color: 'var(--muted)' }}>
            <summary style={{ cursor: 'pointer' }}>
              Show all {scanResult.attempted.length} probe attempts
            </summary>
            <div style={{ marginTop: 8 }}>
              {scanResult.attempted.map((a) => (
                <div key={`${a.url}-${a.source}`} style={{ fontFamily: "'Cascadia Mono', Consolas, monospace" }}>
                  {a.ok ? '✓' : '✗'} <code>{a.url}</code> — {sourceLabel(a.source)}
                  {a.error ? ` (${a.error})` : ''}
                </div>
              ))}
              {scanResult.ollamaHostEnv ? (
                <div style={{ marginTop: 6 }}>
                  OLLAMA_HOST env var: <code>{scanResult.ollamaHostEnv}</code>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
      </>
    );
  }

  function renderHardware(): React.ReactElement {
    if (!hw) return <p className="muted">Detecting hardware…</p>;
    return (
      <dl className="hw-grid">
        <dt>RAM</dt>
        <dd>{hw.totalRamGb.toFixed(1)} GB ({hw.freeRamGb.toFixed(1)} free)</dd>
        <dt>CPU</dt>
        <dd>{hw.cpuModel} ({hw.cpuCores} cores)</dd>
        <dt>GPU</dt>
        <dd>
          {hw.gpus.length === 0
            ? 'None detected (CPU-only inference)'
            : hw.gpus.map((g) => `${g.name}${g.vramMb ? ` (${g.vramMb} MB)` : ''}`).join(', ')}
        </dd>
      </dl>
    );
  }

  function renderPickModel(): React.ReactElement {
    const installed = new Set(
      (ollamaProbe?.installedModels ?? []).map((m) => m.name),
    );
    return (
      <>
        <h2>Pick a model</h2>
        {renderHardware()}
        <p className="muted">
          Models bigger than your RAM either won't load or will swap to disk
          (very slow). Greyed-out cards are above your recommended ceiling.
        </p>
        {MODEL_OPTIONS.map((m) => {
          const tooHeavy = m.minRamGb > ramGb + 1;
          const isInstalled = installed.has(m.tag);
          const isRec = m.tag === recommended;
          const active = pickedModel === m.tag && !customModel.trim();
          const sizeDisplay =
            m.sizeGb < 1
              ? `${(m.sizeGb * 1024).toFixed(0)} MB`
              : `${m.sizeGb.toFixed(1)} GB`;
          return (
            <div
              key={m.tag}
              className={`model-card ${active ? 'active' : ''} ${tooHeavy ? 'disabled' : ''}`}
              onClick={() => {
                if (tooHeavy) return;
                setPickedModel(m.tag);
                setCustomModel('');
              }}
            >
              <div className="head">
                <div className="name">
                  {m.label}
                  {isRec ? <span className="badge rec">Recommended</span> : null}
                  {isInstalled ? <span className="badge installed">Already installed</span> : null}
                  {tooHeavy ? <span className="badge warn">Needs {m.minRamGb}+ GB RAM</span> : null}
                </div>
                <div className="size">{sizeDisplay} · <code>{m.tag}</code></div>
              </div>
              <div className="desc">{m.notes}</div>
              <div
                className="size"
                style={{ marginTop: 6, opacity: 0.85 }}
              >
                ⚡ Warm response: <strong>{m.warmSec}</strong> · Cold load:{' '}
                <strong>{m.coldSec}</strong>
              </div>
            </div>
          );
        })}

        <div className="field-row" style={{ marginTop: 16 }}>
          <label htmlFor="custom-model">Or type a specific Ollama tag</label>
          <input
            id="custom-model"
            type="text"
            value={customModel}
            placeholder="e.g. gemma2:9b-instruct-q4_K_M"
            onChange={(e) => setCustomModel(e.target.value)}
          />
        </div>
      </>
    );
  }

  async function startPull(): Promise<void> {
    setPullError(null);
    setPullProgress(null);
    const model = customModel.trim() || pickedModel;
    const installed = new Set(
      (ollamaProbe?.installedModels ?? []).map((m) => m.name),
    );
    // If already installed, skip the pull and go straight to test.
    if (installed.has(model)) {
      setStep('testing');
      return;
    }
    try {
      const { pullId: id } = await api.pullOllamaModel(model, ollamaEndpoint);
      setPullId(id);
      setStep('pulling');
    } catch (err) {
      setPullError(err instanceof Error ? err.message : String(err));
    }
  }

  function renderPulling(): React.ReactElement {
    const p = pullProgress;
    const total = p?.total ?? 0;
    const completed = p?.completed ?? 0;
    const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
    return (
      <>
        <h2>Pulling {customModel.trim() || pickedModel}</h2>
        <p className="muted">
          Downloading the model weights. This is a one-time download — once it's
          on disk Ollama caches it locally. Internet is required only for the pull
          itself.
        </p>
        <div className="progress-shell">
          <div className="progress-line">{p?.status ?? 'starting…'}</div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-line">
            {total > 0 ? `${bytesToHuman(completed)} / ${bytesToHuman(total)} · ${pct}%` : ''}
          </div>
        </div>
        {pullError ? (
          <div className="alert err">
            Pull failed: <code>{pullError}</code>
          </div>
        ) : null}
        {pullError ? (
          <button onClick={() => setStep('pick-model')}>← Back to model pick</button>
        ) : null}
      </>
    );
  }

  function renderTesting(): React.ReactElement {
    if (testing) {
      return (
        <>
          <h2>Testing the model</h2>
          <p className="muted">
            Asking Merlin's brain a quick question to make sure it works end-to-end…
          </p>
          <div className="progress-shell">
            <div className="progress-line">⏳ Waiting for first reply…</div>
            <div className="progress-line" style={{ marginTop: 6 }}>
              First request after a fresh Ollama start needs to load the model
              into memory — can take 30-90 seconds on CPU-only systems for an
              8B model. Subsequent requests come back in 5-10 seconds.
            </div>
          </div>
        </>
      );
    }
    if (testError) {
      const looksLikeTimeout = /timeout|aborted/i.test(testError);
      return (
        <>
          <h2>Model test failed</h2>
          <div className="alert err">
            <strong>Error:</strong> <code>{testError}</code>
          </div>
          {looksLikeTimeout ? (
            <p>
              This was a timeout, not a real failure. The model was probably
              still loading into RAM when we gave up — common on the very first
              call after a pull. Click <strong>Retry test</strong> below — the
              second attempt almost always succeeds because the model stays
              resident for 10 minutes after our test request.
            </p>
          ) : (
            <p>
              The model was downloaded but didn't respond cleanly. You can still
              apply this config — Merlin's brain will silently fall back to no-op
              on each failed tick, so nothing breaks. Or pick a different model.
            </p>
          )}
          <div className="flex-row" style={{ marginTop: 12 }}>
            <button
              className="primary"
              onClick={() => {
                setTestError(null);
                setTestReply(null);
                setStep('testing');
              }}
            >
              Retry test
            </button>
            <button onClick={() => setStep('pick-model')}>← Pick a different model</button>
          </div>
        </>
      );
    }
    return (
      <>
        <h2>Model works</h2>
        <div className="alert ok">
          ✓ First reply received from <code>{customModel.trim() || pickedModel}</code>.
        </div>
        {testReply ? (
          <div className="alert info">
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
              Sample reply:
            </div>
            {testReply}
          </div>
        ) : null}
      </>
    );
  }

  async function applyAndClose(): Promise<void> {
    try {
      if (choice === 'default') {
        await api.apply({ controllerId: 'default' });
      } else if (choice === 'local-llm') {
        const model = customModel.trim() || pickedModel;
        await api.apply({
          controllerId: 'local-llm',
          config: { endpoint: ollamaEndpoint, model, temperature: 0.8 },
          mirrorToChat,
        });
      } else {
        await api.apply({
          controllerId: 'hermes',
          config: { endpoint: hermesEndpoint, model: hermesModel, temperature: 0.7 },
        });
      }
      api.close();
    } catch (err) {
      // Surface in alert instead of crashing the wizard.
      // eslint-disable-next-line no-alert
      alert(`Couldn't apply: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function renderDone(): React.ReactElement {
    const localModel = customModel.trim() || pickedModel;
    // Cross-check: is the picked model big enough for chat to be useful?
    // Anything below 3B is fine for the brain's tiny JSON but feels weak in
    // multi-turn conversation. We pull this signal from the catalog where we
    // can; for free-text tags we err toward "warn" if it contains :1b / :0.5b.
    const meta = MODEL_OPTIONS.find((m) => m.tag === localModel);
    const looksTinyForChat = meta
      ? meta.minRamGb <= 4
      : /:0?\.\d|:1b/i.test(localModel);
    return (
      <>
        <h2>All set</h2>
        <div className="alert ok">
          ✓ Merlin's brain is ready to go.
        </div>
        <p className="muted">
          {choice === 'default' &&
            'You stayed on the default timer-based brain. Nothing changes.'}
          {choice === 'local-llm' && (
            <>
              Local-LLM brain will tick every ~5 minutes while you're idle and
              ask <code>{localModel}</code> what Merlin should do. If anything
              goes wrong (Ollama stopped, model deleted), the brain falls back
              silently to no-op and Merlin keeps working.
            </>
          )}
          {choice === 'hermes' && (
            <>
              Hermes brain will tick every ~5 minutes against{' '}
              <code>{hermesEndpoint}</code> using profile{' '}
              <code>{hermesModel}</code>.
            </>
          )}
        </p>
        {choice === 'local-llm' && (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 8,
            }}
          >
            <label
              htmlFor="mirror-to-chat"
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}
            >
              <input
                id="mirror-to-chat"
                type="checkbox"
                checked={mirrorToChat}
                onChange={(e) => setMirrorToChat(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong>Also use this model when I chat with Merlin</strong>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Sets the Chat (Conversational) LLM provider to Ollama with{' '}
                  <code>{localModel}</code> at <code>{ollamaEndpoint}</code>.
                  One model, both surfaces.
                </div>
                {looksTinyForChat ? (
                  <div
                    className="alert warn"
                    style={{ marginTop: 8, fontSize: 12, padding: '8px 10px' }}
                  >
                    ⚠ <strong>Heads-up:</strong> <code>{localModel}</code> is
                    sized for the brain&apos;s tiny JSON-schema decisions. It
                    works for the brain but feels limited in actual
                    conversation. For chat-as-well, consider a 3B+ model
                    (Llama 3.2 3B, Qwen 2.5 Coder 3B, Mistral 7B, etc.).
                  </div>
                ) : null}
              </span>
            </label>
          </div>
        )}
        <p className="muted">
          You can change any of this later from Settings → Brain (or Settings →
          Chat for the chat provider).
        </p>
      </>
    );
  }

  async function probeHermes(): Promise<void> {
    setHermesProbing(true);
    setHermesProbe(null);
    try {
      if (hermesKey) {
        await api.setSecret('hermes_api_key', hermesKey);
        setHermesKeySaved(true);
        setHermesKey('');
      }
      const res = await api.probeHermes(hermesEndpoint, hermesKey || '__use_saved__');
      setHermesProbe({
        ok: res.reachable,
        models: res.models,
        profiles: res.profiles,
        ...(res.error ? { error: res.error } : {}),
      });
      if (res.reachable && res.models[0] && !hermesModel) {
        setHermesModel(res.models[0]);
      }
    } catch (err) {
      setHermesProbe({
        ok: false,
        models: [],
        profiles: [],
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setHermesProbing(false);
    }
  }

  function renderHermesConfig(): React.ReactElement {
    return (
      <>
        <h2>Configure Hermes</h2>
        <p className="muted">
          Point Merlin at any Hermes Agent endpoint. Format is{' '}
          <code>http://host:port/v1</code>. Use the discovery button if you have
          multiple profiles running.
        </p>
        <div className="field-row">
          <label htmlFor="h-endpoint">Endpoint</label>
          <input
            id="h-endpoint"
            type="text"
            value={hermesEndpoint}
            placeholder="http://192.168.0.42:8642/v1"
            onChange={(e) => setHermesEndpoint(e.target.value)}
          />
        </div>
        <div className="field-row">
          <label htmlFor="h-key">
            API key {hermesKeySaved ? '(currently saved — leave blank to keep)' : ''}
          </label>
          <input
            id="h-key"
            type="password"
            value={hermesKey}
            placeholder={hermesKeySaved ? '•••••••• (saved)' : 'paste your API_SERVER_KEY'}
            onChange={(e) => setHermesKey(e.target.value)}
          />
        </div>
        <button
          className="primary"
          disabled={hermesProbing || !hermesEndpoint.trim()}
          onClick={() => void probeHermes()}
        >
          {hermesProbing ? 'Probing…' : 'Test connection'}
        </button>

        {hermesProbe ? (
          hermesProbe.ok ? (
            <div className="alert ok" style={{ marginTop: 12 }}>
              ✓ Reached Hermes. {hermesProbe.models.length} model(s) advertised.
            </div>
          ) : (
            <div className="alert err" style={{ marginTop: 12 }}>
              Couldn't reach Hermes: <code>{hermesProbe.error ?? 'unknown error'}</code>
            </div>
          )
        ) : null}

        {hermesProbe?.ok && hermesProbe.models.length > 0 ? (
          <div className="field-row" style={{ marginTop: 12 }}>
            <label htmlFor="h-model">Profile / model</label>
            <select
              id="h-model"
              value={hermesModel}
              onChange={(e) => setHermesModel(e.target.value)}
              style={{
                width: '100%',
                padding: 6,
                background: 'var(--panel-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 6,
              }}
            >
              {hermesProbe.models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        ) : null}
      </>
    );
  }

  // ── Footer: Back / Next / Apply / Close ──────────────────────────────────

  function canAdvance(): boolean {
    switch (step) {
      case 'intro':
        return true;
      case 'ollama-probe':
        return Boolean(ollamaProbe?.reachable);
      case 'ollama-missing':
        return false; // user must successfully re-probe to advance
      case 'pick-model':
        return Boolean((customModel.trim() || pickedModel).length > 0);
      case 'pulling':
        return pullProgress?.done === 'done';
      case 'testing':
        return !testing;
      case 'hermes-config':
        return Boolean(hermesProbe?.ok);
      case 'hermes-test':
        return true;
      default:
        return true;
    }
  }

  function advance(): void {
    if (step === 'intro') {
      if (choice === 'default') {
        setStep('done');
      } else if (choice === 'local-llm') {
        setStep('ollama-probe');
        void startOllamaScan();
      } else {
        setStep('hermes-config');
      }
      return;
    }
    if (step === 'ollama-probe') {
      setStep('pick-model');
      return;
    }
    if (step === 'pick-model') {
      void startPull();
      return;
    }
    if (step === 'pulling') {
      setStep('testing');
      return;
    }
    if (step === 'testing') {
      setStep('done');
      return;
    }
    if (step === 'hermes-config') {
      setStep('done');
      return;
    }
  }

  function back(): void {
    if (step === 'ollama-probe' || step === 'hermes-config') {
      setStep('intro');
      return;
    }
    if (step === 'ollama-missing') {
      setStep('intro');
      return;
    }
    if (step === 'pick-model') {
      setStep('ollama-probe');
      return;
    }
    if (step === 'pulling') {
      if (pullId) void api.cancelPull(pullId).catch(() => undefined);
      setStep('pick-model');
      return;
    }
    if (step === 'testing') {
      setStep('pick-model');
      return;
    }
    if (step === 'done') {
      if (choice === 'local-llm') setStep('testing');
      else if (choice === 'hermes') setStep('hermes-config');
      else setStep('intro');
      return;
    }
  }

  const showBack = step !== 'intro';
  const isDone = step === 'done';

  return (
    <>
      <header>
        <h1>🧙 Brain Setup Wizard</h1>
        <div className="subtitle">
          Decide how Merlin thinks when you're not chatting with him.
        </div>
      </header>
      <main>
        <StepPills step={step} choice={choice} />
        {step === 'intro' && renderIntro()}
        {step === 'ollama-probe' && renderOllamaProbe()}
        {step === 'ollama-missing' && renderOllamaMissing()}
        {step === 'pick-model' && renderPickModel()}
        {step === 'pulling' && renderPulling()}
        {step === 'testing' && renderTesting()}
        {step === 'done' && renderDone()}
        {step === 'hermes-config' && renderHermesConfig()}
      </main>
      <footer>
        {showBack ? <button onClick={back}>← Back</button> : <span />}
        <span className="spacer" />
        <button onClick={() => api.close()}>Cancel</button>
        {isDone ? (
          <button className="primary" onClick={() => void applyAndClose()}>
            Apply &amp; close
          </button>
        ) : (
          <button className="primary" disabled={!canAdvance()} onClick={advance}>
            {step === 'pick-model'
              ? customModel.trim() || pickedModel
                ? `Pull ${customModel.trim() || pickedModel} →`
                : 'Next →'
              : 'Next →'}
          </button>
        )}
      </footer>
    </>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
