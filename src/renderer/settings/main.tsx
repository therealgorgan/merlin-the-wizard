import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  CharacterForUi,
  ProviderInfoForUi,
  StoreSnapshot,
  SapiVoiceForUi,
} from '@shared/ipc-contract';
import { EDGE_VOICES } from '@shared/edge-voices';
import { EXTENSIONS_CATALOG } from '@shared/extensions-catalog';
import { BRAIN_MODEL_CATALOG } from '@shared/brain-models-catalog';

declare global {
  interface Window {
    settingsApi?: import('@shared/ipc-contract').SettingsApi;
  }
}

const api = window.settingsApi;

// Mirror of voice/elevenlabs.ts presets — duplicated here because the
// renderer can't import from main-process modules. Keep in sync if the
// main-side list changes.
const ELEVENLABS_PRESETS: ReadonlyArray<{ id: string; label: string }> = [
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel — calm female (default)' },
  { id: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi — strong female' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella — soft female' },
  { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni — well-rounded male' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', label: 'Elli — emotional female' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh — deep male' },
  { id: 'VR6AewLTigWG4xSOukaG', label: 'Arnold — crisp male' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam — narration male' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', label: 'Sam — raspy male' },
];
const ELEVENLABS_PRESET_IDS = new Set(ELEVENLABS_PRESETS.map((v) => v.id));

function ProviderCard(props: {
  info: ProviderInfoForUi;
  selected: boolean;
  currentModel: string;
  ollamaEndpoint: string;
  hermesEndpoint: string;
  hasKey: boolean;
  onSelect: () => void;
  onModelChange: (model: string) => void;
  onOllamaEndpointChange: (url: string) => void;
  onHermesEndpointChange: (url: string) => void;
  onHermesProfilePick: (profile: { name: string; url: string }) => void;
  onKeySave: (key: string) => Promise<void>;
  onKeyClear: () => Promise<void>;
  onOpenLink: (url: string) => void;
}): React.ReactElement {
  const {
    info,
    selected,
    currentModel,
    ollamaEndpoint,
    hermesEndpoint,
    hasKey,
    onSelect,
    onModelChange,
    onOllamaEndpointChange,
    onHermesEndpointChange,
    onHermesProfilePick,
    onKeySave,
    onKeyClear,
    onOpenLink,
  } = props;
  const [discoveredProfiles, setDiscoveredProfiles] = useState<
    { name: string; url: string }[]
  >([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoverStatus, setDiscoverStatus] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<string>('');

  const badge = info.needsApiKey
    ? hasKey
      ? { text: 'Configured', cls: 'ok' as const }
      : { text: 'Needs key', cls: 'warn' as const }
    : { text: 'Local', cls: 'ok' as const };

  return (
    <div
      className={`provider-card ${selected ? 'active' : ''}`}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        // Don't hijack clicks on inner inputs/buttons.
        if (t.tagName === 'INPUT' || t.tagName === 'BUTTON' || t.tagName === 'SELECT') return;
        onSelect();
      }}
    >
      <div className="provider-header">
        <input
          type="radio"
          name="provider"
          checked={selected}
          onChange={onSelect}
          aria-label={`Select ${info.displayName}`}
        />
        <span className="name">{info.displayName}</span>
        <span className={`badge ${badge.cls}`}>{badge.text}</span>
      </div>
      <div className="provider-body">
        {/* Hermes profiles are URL-bound (one port = one profile = one model), */}
        {/* so the freeform Model field is redundant — the Profile dropdown below */}
        {/* sets it. Every other provider uses the generic Model input. */}
        {info.id !== 'hermes' && (
          <div className="row">
            <label htmlFor={`model-${info.id}`}>Model</label>
            <input
              id={`model-${info.id}`}
              type="text"
              list={`models-${info.id}`}
              value={selected ? currentModel : info.defaultModel}
              placeholder={info.defaultModel}
              onChange={(e) => onModelChange(e.target.value)}
              disabled={!selected}
            />
            <datalist id={`models-${info.id}`}>
              {info.suggestedModels.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        )}

        {info.id === 'ollama' && (
          <div className="row">
            <label htmlFor="ollama-url">Endpoint</label>
            <input
              id="ollama-url"
              type="text"
              value={ollamaEndpoint}
              placeholder="http://localhost:11434/api"
              onChange={(e) => onOllamaEndpointChange(e.target.value)}
              disabled={!selected}
            />
          </div>
        )}

        {info.id === 'hermes' && (
          <>
            <div className="row">
              <label htmlFor="hermes-url">Base URL</label>
              <input
                id="hermes-url"
                type="text"
                value={hermesEndpoint}
                placeholder="http://your-hermes-host:8642/v1"
                onChange={(e) => onHermesEndpointChange(e.target.value)}
                disabled={!selected}
              />
            </div>
            <div className="row">
              <label> </label>
              <button
                className="secondary"
                disabled={!selected || !hermesEndpoint || !hasKey || discovering}
                onClick={async () => {
                  setDiscovering(true);
                  setDiscoverStatus('');
                  try {
                    const list = await window.settingsApi?.discoverHermesModels?.();
                    if (list && list.length) {
                      // This-port probe only returns model names — synthesize
                      // entries using the currently-configured URL so the
                      // dropdown still works.
                      setDiscoveredProfiles(
                        list.map((name) => ({ name, url: hermesEndpoint })),
                      );
                      setDiscoverStatus(`This port: ${list.join(', ')}`);
                    } else {
                      setDiscoverStatus('No models returned.');
                    }
                  } catch (err) {
                    setDiscoverStatus(`Failed: ${(err as Error).message}`);
                  } finally {
                    setDiscovering(false);
                  }
                }}
              >
                {discovering ? '...' : 'Probe this port'}
              </button>
              <button
                className="secondary"
                disabled={!selected || !hermesEndpoint || !hasKey || discovering}
                onClick={async () => {
                  setDiscovering(true);
                  setDiscoverStatus('Scanning ports 8640–8670…');
                  try {
                    const list = await window.settingsApi?.discoverAllHermesProfiles?.();
                    if (list && list.length) {
                      setDiscoveredProfiles(list);
                      setDiscoverStatus(
                        `Found ${list.length} profile(s) on this host. ` +
                        `Switch via tray → Hermes profile, or pick one from "Profile" below.`,
                      );
                    } else {
                      setDiscoverStatus('No profiles found on this host.');
                    }
                  } catch (err) {
                    setDiscoverStatus(`Failed: ${(err as Error).message}`);
                  } finally {
                    setDiscovering(false);
                  }
                }}
              >
                {discovering ? '...' : 'Discover ALL profiles on host'}
              </button>
            </div>
            {discoveredProfiles.length > 0 && (
              <div className="row">
                <label>Profile</label>
                <select
                  onChange={(e) => {
                    const picked = discoveredProfiles.find(
                      (p) => p.name === e.target.value,
                    );
                    if (picked) onHermesProfilePick(picked);
                  }}
                  value={currentModel}
                  disabled={!selected}
                >
                  {discoveredProfiles.map((p) => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="status">
              Point at any Hermes profile's OpenAI-compatible endpoint (one
              per profile, port range typically 8642+). Each gateway port =
              a different profile. {discoverStatus}
            </div>
          </>
        )}

        {info.needsApiKey && (
          <>
            <div className="row">
              <label htmlFor={`key-${info.id}`}>API Key</label>
              <input
                id={`key-${info.id}`}
                type="password"
                value={keyInput}
                placeholder={hasKey ? '•••••••• (saved)' : 'paste key here'}
                onChange={(e) => setKeyInput(e.target.value)}
                disabled={!selected}
              />
              <button
                className="primary"
                disabled={!selected || savingKey || !keyInput}
                onClick={async () => {
                  setSavingKey(true);
                  setKeyStatus('');
                  try {
                    await onKeySave(keyInput);
                    setKeyInput('');
                    setKeyStatus('Saved.');
                  } catch (err) {
                    setKeyStatus(`Failed: ${(err as Error).message}`);
                  } finally {
                    setSavingKey(false);
                  }
                }}
              >
                {savingKey ? '...' : 'Save'}
              </button>
            </div>
            <div className="status">
              {keyStatus}
              {hasKey && !keyStatus && (
                <>
                  <span className="ok">Key saved (encrypted via DPAPI).</span>{' '}
                  <button
                    className="danger-link"
                    onClick={async () => {
                      await onKeyClear();
                      setKeyStatus('Cleared.');
                    }}
                  >
                    Clear
                  </button>
                </>
              )}
              {info.keyHelpUrl && (
                <>
                  {(hasKey || keyStatus) && ' · '}
                  <button
                    className="help"
                    onClick={() => info.keyHelpUrl && onOpenLink(info.keyHelpUrl)}
                  >
                    Get a key →
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Brain model catalog now lives in src/shared/brain-models-catalog.ts so the
// Brain Setup Wizard and Settings → Brain stay in sync.

/** Brain-model picker — surfaces curated catalog + user's installed models
 *  with response-time estimates. Lets users swap on the fly without
 *  re-running the wizard. Only meaningful when brainController === 'local-llm'. */
function BrainModelPicker(props: {
  active: boolean;
  currentModel: string;
  onSelect: (model: string) => void;
}): React.ReactElement | null {
  const { active, currentModel, onSelect } = props;
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState(currentModel);

  useEffect(() => {
    if (!active || !api) return;
    void api.listOllamaModels()
      .then((list) => setInstalled(new Set(list.map((m) => m.name))))
      .catch(() => setInstalled(new Set()));
  }, [active]);

  if (!active) return null;

  const curated = BRAIN_MODEL_CATALOG.map((m) => m.tag);
  const inCatalog = new Set(curated);
  // Show installed-but-not-curated models at the top of the list too.
  const extraInstalled = Array.from(installed).filter((n) => !inCatalog.has(n));
  const isCustom = customMode || (!inCatalog.has(currentModel) && !installed.has(currentModel));

  return (
    <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
      <label htmlFor="brain-model" style={{ flex: '0 0 90px' }}>Model</label>
      {isCustom ? (
        <>
          <input
            id="brain-model-custom"
            type="text"
            value={customValue}
            placeholder="e.g. llama3.2:3b"
            onChange={(e) => setCustomValue(e.target.value)}
            onBlur={() => {
              if (customValue.trim() && customValue.trim() !== currentModel) {
                onSelect(customValue.trim());
              }
            }}
            style={{ flex: '1 1 auto' }}
          />
          <button
            className="secondary"
            onClick={() => {
              setCustomMode(false);
              setCustomValue(currentModel);
            }}
            style={{ flex: '0 0 auto' }}
          >
            ↺ Catalog
          </button>
        </>
      ) : (
        <select
          id="brain-model"
          value={currentModel}
          onChange={(e) => {
            if (e.target.value === '__custom__') {
              setCustomMode(true);
              setCustomValue(currentModel);
            } else {
              onSelect(e.target.value);
            }
          }}
        >
          {extraInstalled.length > 0 ? (
            <optgroup label="✓ Installed (not in catalog)">
              {extraInstalled.map((tag) => (
                <option key={tag} value={tag}>{tag} — installed</option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label="Curated for brain use">
            {BRAIN_MODEL_CATALOG.map((m) => {
              const isInstalled = installed.has(m.tag);
              return (
                <option key={m.tag} value={m.tag}>
                  {m.label} · {m.sizeGb < 1 ? `${(m.sizeGb * 1024).toFixed(0)} MB` : `${m.sizeGb} GB`} · warm {m.warmSec}{isInstalled ? ' · installed ✓' : ''}
                </option>
              );
            })}
          </optgroup>
          <option value="__custom__">Custom model tag…</option>
        </select>
      )}
      <div className="status ext-desc" style={{ flex: '1 0 100%' }}>
        {(() => {
          const meta = BRAIN_MODEL_CATALOG.find((m) => m.tag === currentModel);
          if (meta) {
            const isInstalled = installed.has(currentModel);
            return (
              <>
                {isInstalled ? '✓ Installed. ' : '⚠ Not installed yet — re-run the Brain Setup Wizard to pull. '}
                {meta.notes} (Cold-load {meta.coldSec}, warm response {meta.warmSec}.)
              </>
            );
          }
          return installed.has(currentModel)
            ? `✓ "${currentModel}" is installed and ready.`
            : `⚠ "${currentModel}" is not in your installed list — Ollama will try to pull on first tick. Use the Brain Setup Wizard for a guided pull with progress.`;
        })()}
      </div>
    </div>
  );
}

/** A standalone button + status line for forcing one brain tick on demand.
 *  Useful for verifying local-llm / hermes brains without waiting for the
 *  normal 5-min cadence. */
function BrainTestButton(): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="row" style={{ marginTop: 12 }}>
      <button
        disabled={busy}
        onClick={async () => {
          if (!api) return;
          setBusy(true);
          setResult(null);
          try {
            const r = await api.forceBrainTick();
            setResult(r);
          } catch (err) {
            setResult(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '⏳ Asking the brain…' : '🧠 Test brain now'}
      </button>
      <div className="status ext-desc">
        Forces one decision call right now, bypassing the idle-floor + intent
        gates. Reports what the brain chose. Cold-loading an 8B model can take
        30-90s; subsequent calls return in 5-10s.
        {result ? (
          <div
            style={{
              marginTop: 8,
              padding: '8px 12px',
              background: 'rgba(96,144,255,0.1)',
              borderLeft: '3px solid #6090ff',
              borderRadius: 4,
              fontFamily: "'Cascadia Mono', Consolas, monospace",
              fontSize: 12,
              color: '#cbe4ff',
              whiteSpace: 'pre-wrap',
            }}
          >
            {result}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function App(): React.ReactElement {
  const [providers, setProviders] = useState<ProviderInfoForUi[]>([]);
  const [settings, setSettings] = useState<StoreSnapshot | null>(null);
  const [secretFlags, setSecretFlags] = useState<Record<string, boolean>>({});
  const [sapiVoices, setSapiVoices] = useState<SapiVoiceForUi[]>([]);
  const [characters, setCharacters] = useState<CharacterForUi[]>([]);
  const [tavilyKey, setTavilyKey] = useState('');
  const [tavilySaved, setTavilySaved] = useState(false);
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [elevenLabsSaved, setElevenLabsSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savedAt, setSavedAt] = useState<number>(0);

  useEffect(() => {
    void (async () => {
      if (!api) return;
      const [p, s, v, chars, tav, el] = await Promise.all([
        api.getProviders(),
        api.get(),
        api.getSapiVoices(),
        api.getCharacters(),
        api.hasSecret('tavily_api_key'),
        api.hasSecret('elevenlabs_api_key'),
      ]);
      setProviders(p);
      setSettings(s);
      setSapiVoices(v);
      setCharacters(chars);
      setTavilySaved(tav);
      setElevenLabsSaved(el);
      const flags: Record<string, boolean> = {};
      for (const provider of p) {
        if (provider.secretName) {
          flags[provider.secretName] = await api.hasSecret(provider.secretName);
        }
      }
      setSecretFlags(flags);
      setLoading(false);
    })();
  }, []);

  const update = useMemo(
    () => async (patch: Partial<StoreSnapshot>) => {
      if (!api) return;
      const next = await api.set(patch);
      setSettings(next);
      setSavedAt(Date.now());
    },
    [],
  );

  // Show "Saved ✓" for a couple seconds after any successful save.
  const showSavedBadge = savedAt > 0 && Date.now() - savedAt < 2000;
  useEffect(() => {
    if (savedAt === 0) return;
    const t = setTimeout(() => setSavedAt((v) => v), 2100); // trigger re-render
    return () => clearTimeout(t);
  }, [savedAt]);

  if (loading || !settings || !api) {
    return (
      <div className="app">
        <header>
          <h1>Merlin — Settings</h1>
        </header>
        <main>
          <p>Loading…</p>
        </main>
      </div>
    );
  }

  const activeProviderId = settings.llmProvider;

  return (
    <div className="app">
      <header>
        <h1>Merlin — Settings</h1>
        <div className="subtitle">
          Choose an AI provider, paste your key, and start chatting. Keys are encrypted on this
          machine; nothing is sent anywhere except the provider you select.
        </div>
      </header>
      <main>
        <section>
          <h2>Chat (Conversational LLM)</h2>
          <div className="status">
            The model that answers when you <strong>chat with Merlin</strong> —
            streams text, calls tools, drives his replies. Cloud or local. This
            is <em>separate</em> from the <a href="#brain">Brain LLM</a> below
            (which decides what Merlin does autonomously when you&apos;re not
            chatting).
          </div>
          {providers.map((p) => (
            <ProviderCard
              key={p.id}
              info={p}
              selected={activeProviderId === p.id}
              currentModel={activeProviderId === p.id ? settings.llmModel : p.defaultModel}
              ollamaEndpoint={settings.ollamaEndpoint}
              hermesEndpoint={settings.hermesEndpoint}
              hasKey={p.secretName ? Boolean(secretFlags[p.secretName]) : true}
              onSelect={() => {
                const switching = activeProviderId !== p.id;
                void update({
                  llmProvider: p.id,
                  // When switching to a new provider, snap model to its default
                  // (unless user has typed something custom they want to keep).
                  llmModel: switching ? p.defaultModel : settings.llmModel,
                });
              }}
              onModelChange={(model) => void update({ llmModel: model })}
              onOllamaEndpointChange={(url) => void update({ ollamaEndpoint: url })}
              onHermesEndpointChange={(url) => void update({ hermesEndpoint: url })}
              onHermesProfilePick={(profile) =>
                void update({ hermesEndpoint: profile.url, llmModel: profile.name })
              }
              onKeySave={async (key) => {
                if (!p.secretName) return;
                await api.setSecret(p.secretName, key);
                setSecretFlags((flags) => ({ ...flags, [p.secretName!]: true }));
              }}
              onKeyClear={async () => {
                if (!p.secretName) return;
                await api.clearSecret(p.secretName);
                setSecretFlags((flags) => ({ ...flags, [p.secretName!]: false }));
              }}
              onOpenLink={(url) => void api.openExternal(url)}
            />
          ))}
        </section>

        <section>
          <h2>Character</h2>
          <div className="row">
            <label htmlFor="character">Avatar</label>
            <select
              id="character"
              value={settings.character}
              onChange={(e) => void update({ character: e.target.value })}
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}{c.custom ? ' (custom)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="status">
            {characters.find((c) => c.id === settings.character)?.description}
          </div>
          <div className="row">
            <label> </label>
            <button
              className="secondary"
              onClick={() => void api.openCharactersFolder()}
              title="Open the folder where custom character JSON files live"
            >
              Open characters folder
            </button>
            <button
              className="secondary"
              onClick={async () => {
                const next = await api.reloadCharacters();
                setCharacters(next);
              }}
            >
              Reload
            </button>
          </div>
          <div className="status">
            Drop a JSON file like <code>{`{ "id": "sage-cat", "displayName": "Sage", "personaHint": "...", "baseCharacter": "Links" }`}</code> in that folder and click Reload.
          </div>
        </section>

        <section>
          <h2>Voice</h2>
          <div className="row">
            <label htmlFor="voice-engine">Engine</label>
            <select
              id="voice-engine"
              value={settings.voiceEngine}
              onChange={(e) => void update({ voiceEngine: e.target.value })}
            >
              <option value="off">Off</option>
              <option value="sapi">Windows SAPI (offline, no key)</option>
              <option value="edge">Microsoft Edge Neural (cloud, free, no key)</option>
              <option value="groq">Groq Orpheus (cloud, uses Groq key)</option>
              <option value="openrouter">OpenRouter TTS (cloud, uses OpenRouter key)</option>
              <option value="elevenlabs">ElevenLabs (cloud, separate key — full Voice Library)</option>
            </select>
          </div>
          {settings.voiceEngine === 'sapi' && (
            <>
              <div className="row">
                <label htmlFor="sapi-voice">Voice</label>
                <select
                  id="sapi-voice"
                  value={settings.voiceName}
                  onChange={(e) => void update({ voiceName: e.target.value })}
                >
                  <option value="">(system default)</option>
                  {sapiVoices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                      {v.gender ? ` — ${v.gender}` : ''}
                      {v.culture ? ` · ${v.culture}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="status">
                {sapiVoices.length === 0
                  ? 'No SAPI voices detected. Windows ships with several by default; check Settings → Time & language → Speech.'
                  : `${sapiVoices.length} installed Windows voices found.`}
              </div>
            </>
          )}
          {settings.voiceEngine === 'groq' && (
            <div className="row">
              <label htmlFor="voice-name">Voice</label>
              <select
                id="voice-name"
                value={settings.voiceName}
                onChange={(e) => void update({ voiceName: e.target.value })}
              >
                <option value="troy">Troy (deep male)</option>
                <option value="austin">Austin (male)</option>
                <option value="daniel">Daniel (male)</option>
                <option value="autumn">Autumn (female)</option>
                <option value="diana">Diana (female)</option>
                <option value="hannah">Hannah (female)</option>
              </select>
            </div>
          )}
          {settings.voiceEngine === 'edge' && (
            <>
              <div className="row">
                <label htmlFor="edge-voice">Voice</label>
                <select
                  id="edge-voice"
                  value={
                    settings.voiceName?.includes('Neural')
                      ? settings.voiceName
                      : 'en-GB-RyanNeural'
                  }
                  onChange={(e) => void update({ voiceName: e.target.value })}
                >
                  {EDGE_VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="status">
                Microsoft Edge Neural — free, no API key needed. Requires internet.
              </div>
            </>
          )}
          {/* openrouter voice voices */}
          {settings.voiceEngine === 'openrouter' && (
            <>
              <div className="row">
                <label htmlFor="or-voice">Voice</label>
                <select
                  id="or-voice"
                  value={settings.voiceName}
                  onChange={(e) => void update({ voiceName: e.target.value })}
                >
                  <option value="alloy">Alloy (neutral)</option>
                  <option value="ash">Ash (warm)</option>
                  <option value="ballad">Ballad (smooth)</option>
                  <option value="coral">Coral (bright)</option>
                  <option value="echo">Echo (clear)</option>
                  <option value="fable">Fable (storyteller)</option>
                  <option value="onyx">Onyx (deep male) ⭐</option>
                  <option value="nova">Nova (energetic)</option>
                  <option value="sage">Sage (calm)</option>
                  <option value="shimmer">Shimmer (soft)</option>
                </select>
              </div>
              <div className="status">
                Uses your OpenRouter API key. Model: openai/gpt-4o-mini-tts.
              </div>
            </>
          )}
          {settings.voiceEngine === 'elevenlabs' && (
            <>
              <div className="row">
                <label htmlFor="el-key">ElevenLabs API key</label>
                <input
                  id="el-key"
                  type="password"
                  value={elevenLabsKey}
                  placeholder={elevenLabsSaved ? '•••••••• (saved)' : 'paste your xi-api-key'}
                  onChange={(e) => setElevenLabsKey(e.target.value)}
                />
                <button
                  className="primary"
                  disabled={!elevenLabsKey}
                  onClick={async () => {
                    await api.setSecret('elevenlabs_api_key', elevenLabsKey);
                    setElevenLabsKey('');
                    setElevenLabsSaved(true);
                  }}
                >
                  Save
                </button>
                {elevenLabsSaved && (
                  <button
                    className="danger-link"
                    onClick={async () => {
                      await api.clearSecret('elevenlabs_api_key');
                      setElevenLabsSaved(false);
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="row">
                <label htmlFor="el-voice-preset">Preset voice</label>
                <select
                  id="el-voice-preset"
                  value={
                    ELEVENLABS_PRESET_IDS.has(settings.voiceName)
                      ? settings.voiceName
                      : '__custom__'
                  }
                  onChange={(e) => {
                    if (e.target.value !== '__custom__') {
                      void update({ voiceName: e.target.value });
                    }
                  }}
                >
                  {ELEVENLABS_PRESETS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                  <option value="__custom__">— Custom voice_id below —</option>
                </select>
              </div>
              <div className="row">
                <label htmlFor="el-voice-id">Custom voice ID</label>
                <input
                  id="el-voice-id"
                  type="text"
                  value={settings.voiceName ?? ''}
                  placeholder="e.g. 21m00Tcm4TlvDq8ikWAM"
                  onChange={(e) => void update({ voiceName: e.target.value })}
                />
              </div>
              <div className="status">
                Add any voice from{' '}
                <button className="help" onClick={() => api.openExternal('https://elevenlabs.io/voice-library')}>
                  the ElevenLabs Voice Library →
                </button>{' '}
                to your account, then paste its voice_id above. Billed per
                character against your ElevenLabs quota (free tier: ~10k
                chars/month). Model: eleven_turbo_v2_5.
              </div>
            </>
          )}
        </section>

        <section>
          <h2>Behavior</h2>
          <div className="row">
            <label htmlFor="display-mode">Chat Style</label>
            <select
              id="display-mode"
              value={settings.displayMode}
              onChange={(e) =>
                void update({ displayMode: e.target.value as 'classic' | 'modern' })
              }
            >
              <option value="classic">Classic — floating sprite + speech bubble</option>
              <option value="modern">Modern — floating sprite + docked chat panel</option>
            </select>
          </div>
          <div className="status">
            <strong>Classic</strong> is the nostalgic Microsoft Agent vibe — a tiny
            transparent sprite with a yellow speech bubble. <strong>Modern</strong>
            adds a docked chat panel alongside the sprite: full conversation thread,
            multi-line input, inline attachment previews, per-turn regenerate.
          </div>
          <div className="row">
            <label htmlFor="mute-sfx">
              <input
                id="mute-sfx"
                type="checkbox"
                checked={settings.muteSounds === true}
                onChange={(e) => void update({ muteSounds: e.target.checked })}
              />{' '}
              Mute clippyjs animation sound effects
            </label>
            <div className="status ext-desc">
              Silences the little &quot;ding&quot; / &quot;poof&quot; sounds baked into
              the original Microsoft Agent animation files. Same as the tray
              menu&apos;s &quot;Mute Sound Effects&quot; toggle.
            </div>
          </div>
          <div className="row">
            <label htmlFor="appearance">Sprite appearance</label>
            <select
              id="appearance"
              value={settings.appearance}
              onChange={(e) =>
                void update({ appearance: e.target.value as 'classic' | 'retouched' })
              }
            >
              <option value="classic">Classic — original 90s pixel art</option>
              <option value="retouched">Retouched — smoothed for modern displays</option>
            </select>
          </div>
          <div className="status">
            <strong>Classic</strong> preserves the chunky pixelated MS Agent look.
            <strong> Retouched</strong> lets the browser smooth-upscale the same
            sprites and applies a subtle contrast/shadow filter so Merlin reads
            more like a "rendered" character on modern high-DPI screens. Takes
            effect immediately.
          </div>
          <div className="row">
            <label htmlFor="username">Your name</label>
            <input
              id="username"
              type="text"
              value={settings.userName ?? ''}
              placeholder="(Merlin will use your Windows username)"
              onChange={(e) =>
                void update({ userName: e.target.value.trim() || null })
              }
            />
          </div>
          <div className="row-grid">
            <div className="row">
              <label htmlFor="welcome">
                <input
                  id="welcome"
                  type="checkbox"
                  checked={settings.showWelcomeOnStart}
                  onChange={(e) => void update({ showWelcomeOnStart: e.target.checked })}
                />{' '}
                Show welcome greeting on startup
              </label>
            </div>
            <div className="row">
              <label htmlFor="speak-welcome">
                <input
                  id="speak-welcome"
                  type="checkbox"
                  checked={settings.speakWelcome}
                  disabled={!settings.showWelcomeOnStart || settings.voiceEngine === 'off'}
                  onChange={(e) => void update({ speakWelcome: e.target.checked })}
                />{' '}
                Speak the welcome aloud
              </label>
            </div>
            <div className="row">
              <label htmlFor="idle-thoughts">
                <input
                  id="idle-thoughts"
                  type="checkbox"
                  checked={settings.idleThoughtsEnabled}
                  onChange={(e) => void update({ idleThoughtsEnabled: e.target.checked })}
                />{' '}
                Idle thoughts (occasional unprompted remarks)
              </label>
            </div>
            <div className="row">
              <label htmlFor="autostart">
                <input
                  id="autostart"
                  type="checkbox"
                  checked={settings.autoStart}
                  onChange={(e) => void update({ autoStart: e.target.checked })}
                />{' '}
                Start with Windows
              </label>
            </div>
          </div>
        </section>

        <section id="extensions">
          <h2>Extensions</h2>
          <div className="status">
            Toggle individual Merlin behaviors. Defaults match the experience you
            get with everything on. Changes apply immediately — no restart needed.
          </div>
          {Array.from(
            EXTENSIONS_CATALOG.reduce<Map<string, typeof EXTENSIONS_CATALOG[number][]>>(
              (acc, flag) => {
                const list = acc.get(flag.group) ?? [];
                list.push(flag);
                acc.set(flag.group, list);
                return acc;
              },
              new Map(),
            ).entries(),
          ).map(([group, flags]) => (
            <div key={group} className="extensions-group">
              <h3 className="extensions-group-title">{group}</h3>
              <div className="flag-grid">
                {flags.map((flag) => {
                  const stored = settings.extensions?.[flag.key];
                  const current = stored !== undefined ? stored : flag.default;
                  if (flag.kind === 'boolean') {
                    return (
                      <div key={flag.key} className="flag-cell">
                        <label htmlFor={`ext-${flag.key}`} className="flag-cell-label">
                          <input
                            id={`ext-${flag.key}`}
                            type="checkbox"
                            checked={current === true}
                            onChange={(e) =>
                              void update({
                                extensions: {
                                  ...(settings.extensions ?? {}),
                                  [flag.key]: e.target.checked,
                                },
                              })
                            }
                          />{' '}
                          <span>{flag.label}</span>
                        </label>
                        <div className="flag-cell-desc">{flag.description}</div>
                      </div>
                    );
                  }
                  return (
                    <div key={flag.key} className="flag-cell flag-cell-wide">
                      <label htmlFor={`ext-${flag.key}`} className="flag-cell-select-label">
                        {flag.label}
                      </label>
                      <select
                        id={`ext-${flag.key}`}
                        value={typeof current === 'string' ? current : flag.default}
                        onChange={(e) =>
                          void update({
                            extensions: {
                              ...(settings.extensions ?? {}),
                              [flag.key]: e.target.value,
                            },
                          })
                        }
                        className="flag-cell-select"
                      >
                        {flag.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <div className="flag-cell-desc">{flag.description}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        <section id="brain">
          <h2>Brain (Autonomous LLM)</h2>
          <div className="status">
            <strong>Independent of the Chat LLM at the top of this window.</strong>{' '}
            The Brain is what decides what Merlin does <em>while you&apos;re NOT
            chatting</em> — idle thoughts, wandering, gestures. Fires once every
            ~5 minutes. The <strong>Default</strong> controller uses no LLM at
            all (just a timer); <strong>Local LLM</strong> uses an Ollama model
            on your own machine (free, private, offline-capable);{' '}
            <strong>Hermes Agent</strong> uses a self-hosted profile. Run the
            Setup Wizard to walk through Local LLM end-to-end.
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" onClick={() => void api.openBrainWizard()}>
              🧙 Open Brain Setup Wizard…
            </button>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <label htmlFor="brain-ctrl">Active brain controller</label>
            <select
              id="brain-ctrl"
              value={settings.brainController ?? 'default'}
              onChange={(e) => void update({ brainController: e.target.value })}
            >
              <option value="default">Default — timer-based (offline, free)</option>
              <option value="local-llm">Local LLM — Ollama-driven (free, private)</option>
              <option value="hermes">Hermes Agent — self-hosted profile</option>
            </select>
            <div className="status ext-desc">
              Switching takes effect immediately. If you pick local-llm or
              hermes without running the wizard, Merlin will silently fall back
              to no-op on each tick until you finish configuring it.
            </div>
          </div>
          <BrainModelPicker
            active={(settings.brainController ?? 'default') === 'local-llm'}
            currentModel={
              (settings.brainControllerConfig?.['local-llm'] as { model?: string } | undefined)
                ?.model ?? 'llama3.2:3b'
            }
            onSelect={(model) => {
              const prev = settings.brainControllerConfig ?? {};
              const prevLocal = (prev['local-llm'] as Record<string, unknown> | undefined) ?? {};
              void update({
                brainControllerConfig: {
                  ...prev,
                  'local-llm': { ...prevLocal, model },
                },
              });
            }}
          />
          <BrainTestButton />
        </section>

        <section>
          <h2>Hotkeys</h2>
          <div className="row">
            <label htmlFor="summon-hotkey">Summon Merlin</label>
            <input
              id="summon-hotkey"
              type="text"
              value={settings.summonHotkey}
              placeholder="Control+Shift+M"
              onChange={(e) => void update({ summonHotkey: e.target.value })}
            />
          </div>
          <div className="row">
            <label htmlFor="screenshot-hotkey-enabled">
              <input
                id="screenshot-hotkey-enabled"
                type="checkbox"
                checked={settings.screenshotHotkeyEnabled}
                onChange={(e) =>
                  void update({ screenshotHotkeyEnabled: e.target.checked })
                }
              />{' '}
              Capture-screen hotkey
            </label>
          </div>
          <div className="row">
            <label htmlFor="screenshot-hotkey">Capture screen</label>
            <input
              id="screenshot-hotkey"
              type="text"
              value={settings.screenshotHotkey}
              placeholder="Control+Shift+S"
              disabled={!settings.screenshotHotkeyEnabled}
              onChange={(e) => void update({ screenshotHotkey: e.target.value })}
            />
          </div>
          <div className="status">
            Use Electron Accelerator syntax: <code>Control+Shift+M</code>,{' '}
            <code>Alt+F12</code>, etc. Changes register immediately.
          </div>
        </section>

        <section>
          <h2>Tools</h2>
          <div className="row">
            <label htmlFor="tavily-key">Tavily API key</label>
            <input
              id="tavily-key"
              type="password"
              value={tavilyKey}
              placeholder={tavilySaved ? '•••••••• (saved)' : 'optional — for web search'}
              onChange={(e) => setTavilyKey(e.target.value)}
            />
            <button
              className="primary"
              disabled={!tavilyKey}
              onClick={async () => {
                await api.setSecret('tavily_api_key', tavilyKey);
                setTavilyKey('');
                setTavilySaved(true);
              }}
            >
              Save
            </button>
            {tavilySaved && (
              <button
                className="danger-link"
                onClick={async () => {
                  await api.clearSecret('tavily_api_key');
                  setTavilySaved(false);
                }}
              >
                Clear
              </button>
            )}
          </div>
          <div className="status">
            With a Tavily key, Merlin can search the live web for current info.
            Without one, he falls back to DuckDuckGo Instant Answers (limited).{' '}
            <button className="help" onClick={() => api.openExternal('https://tavily.com/')}>
              Get a free Tavily key →
            </button>
          </div>
        </section>
      </main>
      <footer>
        <span className={`saved-badge ${showSavedBadge ? 'visible' : ''}`}>
          {showSavedBadge ? 'Saved ✓' : 'Changes save automatically.'}
        </span>
        <button className="secondary" onClick={() => api.close()}>
          Close
        </button>
      </footer>
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
