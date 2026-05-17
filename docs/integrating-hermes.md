# Wiring Merlin to Hermes Agent

> Use **[Hermes Agent](https://github.com/nousresearch/hermes-agent)** as
> Merlin's brain. Merlin keeps the body — sprite, voice, bubble, mood,
> animations — and Hermes handles the thinking, memory, and tools.

This is the **"Hermes-as-brain"** integration: when a user double-clicks
Merlin and asks a question, the question is sent to a Hermes profile's
OpenAI-compatible endpoint. Hermes's profile-specific personality,
long-term memory, and tool stack take over. The reply streams back through
Merlin's bubble with sprite animations layered on via inline `[anim:Name]`
tags.

---

## Why this design

- **Hermes already has 40+ tools** (file ops, messaging gateways, code
  execution, memory backends). No reason to duplicate them on Merlin's
  side.
- **Hermes profiles already have personalities and memory.** Each profile
  ships its own `SOUL.md`, skills, and per-channel context. Merlin's
  client-side persona would fight with that, so we strip it.
- **Switching the brain is free.** Hermes runs N gateway processes (one
  per profile) on adjacent ports — so "switch from `assistant` to
  `sonnet`" is just "talk to a different port."

---

## Prerequisites

1. **A running Hermes deployment** somewhere you can reach from the
   Windows machine running Merlin. Most common setup: Hermes on a
   home-lab Linux box, accessed via [Tailscale](https://tailscale.com).
2. **Each profile you want to expose must have the `api_server`
   gateway platform enabled** — Hermes ships this gateway out of the
   box; it serves the OpenAI Chat Completions API on a per-profile port
   (default range starting at `8642`).
3. **An API server bearer key** — Hermes reads it from `API_SERVER_KEY`
   in `~/.hermes/.env`. The same key works for every profile/port.

To check what's running on your Hermes host:

```bash
ssh your-hermes-host "ss -tlnp | grep python"
# Each Hermes gateway listens on one TCP port; map pid → profile via:
ssh your-hermes-host "ps auxf | grep hermes_cli"
```

The output will show one process per profile, e.g.:

```
… hermes_cli.main --profile assistant gateway run …
… hermes_cli.main --profile sonnet    gateway run …
…
```

Match the pid in `ss -tlnp` output to find each profile's port.

---

## One-time setup in Merlin

### 1. Pick a Hermes endpoint URL

A Hermes profile's endpoint always has the shape:

```
http://<host>:<port>/v1
```

- `<host>` — the address of your Hermes box. For a local install use
  `localhost`. For a homelab box reachable via Tailscale, use the Tailscale
  IP (e.g. `100.x.y.z`). For a LAN box, the LAN IP (`192.168.x.y`).
- `<port>` — the port of the **specific profile** you want to use as
  the default.

Examples:
- `http://localhost:8642/v1` — Hermes on the same machine, default gateway
- `http://100.x.y.z:8642/v1` — remote homelab box via Tailscale, default gateway
- `http://100.x.y.z:8649/v1` — same box but pointing at a specific profile (each profile gets a unique port)

### 2. Configure Merlin

1. Right-click Merlin → **Settings…**
2. Under **AI Provider**, pick **"Hermes Agent (self-hosted)"**.
3. Paste your **Base URL** into the field (e.g. `http://localhost:8642/v1` for a local install).
4. Paste your **API Key** (the value of `API_SERVER_KEY` from Hermes's
   `.env` file) and click **Save**. Keys are encrypted at rest via
   Windows DPAPI; they never leave your machine.
5. Click **Discover ALL profiles on host**. Merlin probes ports
   `8640–8670` on the host you configured and caches every profile that
   responds. This list powers the tray-menu quick-switcher.
6. Close Settings.

> **Note:** Merlin also runs discovery automatically at app startup whenever
> Hermes is the active provider and the cache is empty, so on most machines
> step 5 only happens once — restart Merlin and the tray menu fills itself.

### 3. Switch profiles on the fly

Right-click Merlin → **Hermes profile ▸** to see every profile Merlin
discovered. Click one and the next message goes to that brain instantly.
The radio button shows which profile is currently active.

To re-scan (e.g. after starting a new profile on the Hermes side),
right-click Merlin → Hermes profile → **Discover all profiles…**.

---

## How to choose a profile

Each Hermes profile is a separate brain with its own knowledge, voice,
and tool access. There's no "best" profile — pick by what you're doing.

| Situation | Profile to pick |
|---|---|
| General-purpose chat, "what's on my plate today" | A general/assistant-style profile (look for one whose `SOUL.md` doesn't restrict scope) |
| Heavy dev work — needs file/Bash/SSH tools | Whichever profile is wired to your strongest model (e.g. Claude Sonnet via a `claude-proxy` provider) and has tool access turned on |
| Project-specific questions | A profile whose `SOUL.md` is scoped to that project. Project-scoped profiles refuse to answer about other projects, which is a feature, not a bug |
| Fact-checking, news research | A profile with web search + journalism-style guardrails |
| Sensitive ops (security, disclosure pipelines) | A profile with restricted tool access and audit logging |

A profile's purpose lives in its `SOUL.md`:

```bash
ssh your-hermes-host "head -20 ~/.hermes/profiles/PROFILE_NAME/SOUL.md"
```

If `SOUL.md` is a generic boilerplate, the profile's specialty comes
from its skills/memory rather than its prompt. You'll discover that
through conversation.

---

## Best practices

### Profile scoping
**Project-scoped profiles work best for project-scoped questions.** If
you ask the `assistant` profile about a project, it likely won't know —
its memory was never seeded with that project. Switch to the dedicated
profile (or scope your question to general knowledge).

### Don't expect tools across the boundary
Merlin's local tools (`add_task`, `web_search`, `move_to`, etc.) are
**dropped** when Hermes is the brain. Hermes brings its own equivalents:
its tasks live in its own memory, its web search uses its own provider.
Sprite control still works because the `[anim:Hide]` / `[anim:Show]`
tags are handled client-side by Merlin's streaming parser — Hermes
doesn't need to call a tool, it just emits the inline tag.

### Bubble formatting
Hermes profiles often reply in Markdown. Merlin renders Markdown in the
bubble (headers, lists, code blocks, links). If Hermes is dumping
JSON-shaped tool output instead of natural language, that's a
**profile-side** issue — usually fixed by updating its `SOUL.md` to say
"paraphrase tool results, don't dump them."

### Voice
Merlin's TTS (Edge Neural / SAPI / Groq Orpheus / OpenRouter) is
**independent** of the brain. Hermes-streamed replies speak with
whatever voice you've configured under Settings → Voice. Sentence-level
TTS dispatch happens in the bubble's streaming parser, so the first
sentence speaks while the rest of the reply is still streaming.

### Session continuity
Hermes's `api_server` is **stateless by default**. Each request includes
Merlin's local chat history. If you want Hermes to manage the session
itself (so its memory plugin can remember across Merlin restarts), the
endpoint accepts an `X-Hermes-Session-Id` header — Merlin doesn't send
it today. Open an issue if you want that wired up.

### Multi-host setups
Merlin's host field is a single URL. If you run Hermes on multiple
machines (e.g. one on-prem, one cloud), pick the one you most often use
as the default and switch URLs in Settings when you need the other.
Caching all profiles across multiple hosts isn't supported yet.

---

## What gets sent to Hermes

For every user turn, Merlin sends to `/v1/chat/completions`:

```json
{
  "model": "<profile-name>",
  "messages": [
    { "role": "system", "content": "<minimal tag-grammar prompt>" },
    { "role": "user",   "content": "<earlier user turn>"      },
    { "role": "assistant", "content": "<earlier assistant turn>" },
    ...
    { "role": "user", "content": "<the latest user message>" }
  ],
  "temperature": 0.7,
  "stream": true
}
```

The **system prompt is intentionally tiny** (~2k tokens vs. the ~20k
Hermes already injects server-side). It teaches the model only the
sprite/feel/suggest tag grammar — no character persona, no tool docs,
no context block. Hermes's own `SOUL.md` owns the personality.

Streaming responses come back as standard OpenAI SSE chunks. Merlin's
parser strips `[anim:…]`/`[feel:…]`/`[suggest:…]` inline tags out of
the visible bubble text and routes them to the sprite controller, mood
controller, and suggestion-chip renderer.

---

## Troubleshooting

### `Invalid API key`
You either forgot to save the key in Settings, or `API_SERVER_KEY` in
Hermes's `.env` doesn't match what you pasted. Re-copy from the server:

```bash
ssh your-hermes-host "grep ^API_SERVER_KEY= ~/.hermes/.env | cut -d= -f2-"
```

### `Hermes endpoint not configured`
The Base URL field in Settings is empty. Paste the full URL ending in
`/v1`.

### "Discover ALL profiles" finds nothing
- Your Base URL host is wrong (try `curl http://HOST:8642/health` from
  Windows to verify reachability).
- No profiles have `api_server` in their `platform_toolsets.api_server`
  list. Add `- hermes-api-server` under that key in each profile's
  `~/.hermes/profiles/<name>/config.yaml` and restart its gateway:
  `hermes --profile <name> gateway run --replace`.
- Profiles are listening on ports outside `8640–8670`. Open an issue and
  we'll make the port range configurable.

### Hermes responds but Merlin's sprite doesn't animate
The model isn't following the tag grammar. Try a more instruction-
following model on the Hermes side, or open a Hermes session and add
"You may emit `[anim:Greet]`, `[anim:Wave]`, etc. inline; the desktop
sprite renders them." to that profile's `SOUL.md`.

### "Hermes profile" submenu is empty
Auto-discovery runs at startup, so this normally only happens when the
endpoint or key changes after first boot. Open Settings → Hermes Agent →
click **Discover ALL profiles on host**. After it succeeds, the tray
submenu populates on the next right-click.

### Profile says it doesn't know your project
Profile-scoped knowledge lives in the profile's memory and `SOUL.md`.
General-purpose profiles (like `assistant`) won't know about your
specific projects — switch to a project-scoped profile, or seed the
generic profile by talking about the project (its memory plugin will
remember future turns).

---

## Architecture in one diagram

```
┌──────────────────────── Windows desktop ────────────────────────┐
│                                                                 │
│   ┌────────────┐    user message    ┌──────────────────────┐    │
│   │  Merlin    │ ─────────────────► │ providerRegistry.ts  │    │
│   │  bubble    │                    │ (Hermes case →       │    │
│   │            │ ◄───────────────── │   createOpenAI({     │    │
│   └────────────┘   streaming reply  │     baseURL, apiKey  │    │
│        ▲                            │   })(profileName))   │    │
│        │ tags                       └──────────┬───────────┘    │
│        │                                       │                │
│   ┌────────────┐                               │                │
│   │  sprite    │                               │                │
│   │ controller │   StreamingAnimParser ◄───────┘                │
│   │ (anim/feel)│                                                │
│   └────────────┘                                                │
└─────────────────────────────────┬───────────────────────────────┘
                                  │  HTTPS over Tailscale (or LAN)
                                  ▼
                ┌────────────────────────────────┐
                │ http://<host>:<port>/v1        │
                │  Hermes api_server (per profile)│
                │  → AIAgent (run_agent.py)      │
                │  → profile SOUL + skills +     │
                │    memory + tool stack          │
                └────────────────────────────────┘
```

---

## Future work

Things this integration doesn't do yet — open an issue if you need any
of these:

- **Session continuity** via `X-Hermes-Session-Id` (Hermes keeps the
  conversation; Merlin doesn't need to send history each turn).
- **MCP server mode** — expose Merlin's body (animations, voice,
  bubble, sprite) as MCP tools so Hermes can drive Merlin proactively
  (notification-style: "Hermes wants Merlin to pop up and say X").
- **Configurable scan range** — let users set the port range instead of
  hardcoded `8640–8670`.
- **Multi-host** — cache profiles from more than one Hermes deployment.
- **Per-profile defaults** — remember per-profile voice/character
  preferences, so switching profile also switches voice.

---

*Last updated: 2026-05-16.*
