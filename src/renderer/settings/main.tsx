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
          <h2>AI Provider</h2>
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
            <label htmlFor="display-mode">Display mode</label>
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
              {flags.map((flag) => {
                const stored = settings.extensions?.[flag.key];
                const current = stored !== undefined ? stored : flag.default;
                if (flag.kind === 'boolean') {
                  return (
                    <div key={flag.key} className="row">
                      <label htmlFor={`ext-${flag.key}`}>
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
                        {flag.label}
                      </label>
                      <div className="status ext-desc">{flag.description}</div>
                    </div>
                  );
                }
                return (
                  <div key={flag.key} className="row">
                    <label htmlFor={`ext-${flag.key}`}>{flag.label}</label>
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
                    >
                      {flag.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <div className="status ext-desc">{flag.description}</div>
                  </div>
                );
              })}
            </div>
          ))}
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
