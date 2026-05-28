# Merlin the Wizard 🧙

> A Windows 11 desktop companion that recreates the **Microsoft Agent Merlin**
> as a modern LLM-backed assistant. Multi-provider, voice-enabled, draggable,
> opinionated, and a little bit cheeky.

![status](https://img.shields.io/badge/status-alpha-orange)
![platform](https://img.shields.io/badge/platform-Windows%2011-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![electron](https://img.shields.io/badge/electron-33-brightgreen)
[![Ko-fi](https://img.shields.io/badge/Support-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/gorganslab)

Merlin is the original Windows 98 Microsoft Agent sprite — wizard hat, robe of
moons, animated bows — running natively on Windows 11 as a transparent
always-on-top character you can talk to. Double-click him, ask anything, and
he'll reply through any LLM you point him at, in your chosen voice, with the
right animation playing.

---

## Features

**Animation & character**
- 10 classic MS Agent characters (Merlin, Clippy, Bonzi, F1 Robot, Genie, Genius/Einstein, Links, Peedy, Rocky, Rover) — pick from tray or Settings
- **Smart animation controller** with eye-tracking, mood-weighted picks, recent-anim suppression, sleep/wake cycle, time-of-day + energy modulation, reactive gestures (double-click, drag, zoom, content-aware), tool-outcome animations
- **Classic** (pixelated retro) or **Retouched** (CSS-smoothed for modern displays) sprite appearance
- Drag him anywhere; CSS-composited lift effect during drag (works even when the renderer's busy)
- Custom characters: drop JSON files in `userData/characters/` to define new personas around existing clippyjs visuals

**LLM providers**
- **Groq** (free tier with `llama-3.3-70b-versatile` by default)
- **OpenRouter** (any model — Claude, GPT-5, Gemini, Llama, Mistral, etc.)
- **Ollama** (local models)
- **MiniMax** (M2.7, M2, M1)
- **Hermes Agent** (self-hosted multi-profile gateway — see [docs/integrating-hermes.md](docs/integrating-hermes.md))
- All keys encrypted at rest via Windows DPAPI (`safeStorage`); nothing leaves your machine except outbound to the provider you picked.

**Voice**
- **TTS**: Microsoft Edge Neural (free, no key) / Windows SAPI (offline) / Groq Orpheus / OpenRouter TTS
- **STT**: Groq Whisper push-to-talk (mic button in bubble + panel)
- Bubble↔voice **synced** — text reveals at the same moment audio starts
- TTS sanitizer strips markdown symbols (no more "asterisk asterisk asterisk")

**Tools the LLM can call**
- `move_to(corner)`, `move_relative(direction, amount)`, `hide()`, `show()` — physical sprite control
- `add_task`, `list_tasks`, `complete_task`, `remove_task` — persistent todo
- `web_search(query)` — Tavily (paid, better) or DuckDuckGo (free fallback)

**Two display modes**
- **Classic** — floating transparent sprite + on-demand yellow speech bubble (the nostalgic MS Agent vibe)
- **Modern** — same floating sprite + a docked dark-themed chat panel with the full conversation thread, multi-line input, inline attachment previews, regenerate button, scrollbar styled to match

**Other**
- Drag-drop file attachments (text files prepended to next prompt, 256KB/file, 1MB total)
- Screen capture hotkey (Ctrl+Shift+S) — attaches a screenshot to the next message for vision-capable models
- Global summon hotkey (Ctrl+Shift+M, rebindable)
- Conversation history window with search filter
- Mood system (8 moods), idle thoughts, autonomous wander
- Markdown rendering in the bubble + panel

---

## Requirements

- **Windows 11** (Windows 10 likely works but untested)
- **Node 20+** for development
- A free **Groq API key** to actually chat (the app shows a canned reply without one) — or any of the other supported providers

---

## Setup

```bash
git clone https://github.com/therealgorgan/merlin-the-wizard.git
cd merlin-the-wizard
npm install
npm run assets        # download the original Microsoft Agent sprite packs
cp .env.example .env  # then edit .env to add your GROQ_API_KEY (optional —
                      # you can also set keys via Settings UI at runtime)
npm run dev
```

Merlin should appear in the bottom-right corner of your primary display.
Right-click him for the tray menu. Double-click to chat.

### Configuring an LLM provider

Right-click Merlin → **Settings…** → **AI Provider**. Pick one, paste your
API key, hit Save. Switching providers mid-session works fine.

### Wiring up Hermes Agent

If you self-host [Hermes Agent](https://github.com/nousresearch/hermes-agent),
see [docs/integrating-hermes.md](docs/integrating-hermes.md) for the full
guide — Merlin becomes a thin frontend that drives whichever Hermes profile
you point him at.

---

## Build a distributable

```bash
npm run dist           # NSIS installer in dist/
npm run dist:portable  # single .exe in dist/
```

Code-signing is TODO; releases will warn the user about the unsigned
executable until a cert is in place.

---

## Architecture (quick tour)

```
src/
├── main/                          # Node side (Electron main process)
│   ├── index.ts                   # app lifecycle, tray, hotkeys, boot
│   ├── interaction.ts             # streaming chat loop + voice sync + italic-action filter
│   ├── animationController.ts     # ⭐ single source of truth for sprite intents
│   ├── llm/
│   │   ├── providerRegistry.ts    # Groq/OpenRouter/Ollama/MiniMax/Hermes
│   │   ├── tools.ts               # tool definitions (Vercel AI SDK)
│   │   └── systemPrompt.ts        # built per-turn from character + context
│   ├── voice/
│   │   ├── tts.ts                 # multi-engine TTS dispatcher + sanitizeForSpeech
│   │   ├── whisper.ts             # Groq Whisper for STT
│   │   ├── edge.ts                # MS Edge Neural TTS
│   │   └── sapi.ts                # Windows SAPI TTS (PowerShell)
│   ├── tools/webSearch.ts         # Tavily + DDG fallback
│   ├── windows/                   # BrowserWindow creation/lifecycle
│   │   ├── spriteWindow.ts        # the floating transparent sprite
│   │   ├── bubbleWindow.ts        # classic speech bubble
│   │   ├── chatPanelWindow.ts     # modern docked chat panel
│   │   ├── settingsWindow.ts
│   │   ├── historyWindow.ts
│   │   └── debugWindow.ts
│   ├── storage/
│   │   ├── store.ts               # plain settings (JSON)
│   │   ├── secrets.ts             # API keys via Electron safeStorage
│   │   └── conversationStore.ts   # rolling chat history
│   └── ...
├── preload/                       # contextBridge IPC surfaces
│   ├── sprite.ts, bubble.ts, settings.ts, debug.ts, history.ts, chatPanel.ts
├── renderer/                      # browser-side
│   ├── sprite/                    # clippyjs host (jQuery 3.5.1 bundled)
│   ├── bubble/                    # speech bubble with markdown + mic + drop
│   ├── settings/                  # React settings window
│   ├── history/                   # plain-DOM conversation viewer
│   ├── debug/                     # per-animation playback buttons
│   ├── chat-panel/                # React modern chat panel
│   └── public/agents/             # downloaded MS Agent sprite packs
└── shared/
    ├── animations.ts              # ANIMATIONS list + IDLE/PREEMPTING subsets
    ├── animation-protocol.ts      # StreamingAnimParser ([anim:]/[feel:]/[suggest:])
    ├── function-call-parser.ts    # fallback for inline <function=...> calls
    ├── characters.ts              # 10 built-in characters
    ├── edge-voices.ts             # curated Edge Neural voice list
    ├── ipc-contract.ts            # typed IPC channel map
    └── types.ts
```

The **animation pipeline** (most-touched feature):

```
LLM stream → FunctionCallParser → StreamingAnimParser → ItalicActionFilter
                                                              │
        ┌─────────────────────┬────────────────────┬──────────┴──────────┐
        ▼                     ▼                    ▼                     ▼
   [anim:Name]           [feel:mood]         [suggest:text]          plain text
        │                     │                    │                     │
   AnimationController   feelings.ts          UI chip render      SentenceSplitter
   .playInline()         .setMood()                              → TTS → audio
        │                                                                │
        ▼                                                                ▼
   active sprite host                                            audio queued in
   (sprite window)                                                renderer; first
                                                                  audio → bubble
                                                                  reveals + animation
                                                                  controller transitions
                                                                  thinking → speaking
```

---

## Contributing

PRs welcome. The code aims for: TypeScript strict everywhere, no comments
that just restate the code, prefer editing existing files over creating new
ones, no scope creep. Each turn-of-the-pipeline has a comment block at the
top explaining *why* the design is what it is — read those before changing.

For non-trivial changes, open an issue first to discuss the shape.

---

## Credits

- **clippyjs** (LiquidFusion/Smore/various) — the sprite-frame animation runtime, bundled with jQuery 3.5.x. Pinned because clippyjs is unmaintained since ~2017 but works fine for its purpose.
- **Microsoft** — the original Microsoft Agent characters (Merlin, Clippy, et al.) from the late 90s/early 2000s.
- **Nous Research** — [Hermes Agent](https://github.com/nousresearch/hermes-agent), the optional self-hosted agent backend.

---

## Support

Merlin is a solo project, free and MIT-licensed. If he made you smile (or
saved you a click), tips help keep the wizard fed.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/gorganslab)

---

## License

MIT — see [LICENSE](LICENSE).

Microsoft Agent character art remains the property of Microsoft. This project
uses publicly-distributed sprite assets through the clippyjs CDN; it doesn't
redistribute them.
