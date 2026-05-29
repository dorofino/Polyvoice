# Polyvoice

> One extension, every voice ~~provider~~. Select text in VS Code, press a key, hear it read aloud — through your operating system's built-in TTS or your favorite cloud voice.

Polyvoice lets you read code, Markdown, comments, or any selected text aloud from inside VS Code, and switch between **five TTS providers** without changing extensions:

| Provider | What it gives you |
|---|---|
| **Native OS TTS** | Free, offline, instant. The default on first install. |
| **OpenAI** | `gpt-4o-mini-tts` — ~$0.015 / minute, 13 voices, 50+ languages. |
| **ElevenLabs** | Highest quality. Flash v2.5 streams in ~75 ms. |
| **Azure AI Foundry** | 400+ neural voices, 140+ languages. |
| **xAI Grok TTS** | 5 expressive voices, $4.20 / 1 M chars. |

Bring your own API key for the cloud providers — Polyvoice never proxies your text through anyone else's server.

## Install

Marketplace: search **Polyvoice** (or install `dorofino.polyvoice`).

## Use

1. Select some text.
2. Press **`Ctrl+Alt+S`** (Windows / Linux) or **`⌘⌥S`** (macOS) — or right-click → *Polyvoice: Speak Selection*.

That's it. The default is your OS voice, no setup.

### Switching providers

Click the **Polyvoice** item in the status bar, or run *Polyvoice: Select Provider* from the command palette. The first time you pick a cloud provider, Polyvoice asks for an API key and stores it in VS Code's encrypted `SecretStorage` — never in your settings file.

### Commands

| Command | Default keybinding |
|---|---|
| Polyvoice: Speak Selection | `Ctrl+Alt+S` / `⌘⌥S` |
| Polyvoice: Speak Whole Document | — |
| Polyvoice: Stop | `Ctrl+Alt+X` / `⌘⌥X` |
| Polyvoice: Pause / Resume | `Ctrl+Alt+P` / `⌘⌥P` |
| Polyvoice: Select Provider | — |
| Polyvoice: Select Voice | — |
| Polyvoice: Set API Key for Provider | — |
| Polyvoice: Export Selection to Audio File | — |
| Polyvoice: Clear Audio Cache | — |

### Markdown smarts

When reading a `.md` file, Polyvoice skips fenced code blocks by default. Toggle this in `polyvoice.markdown.skipCodeBlocks`.

### Per-language voice map

Map locales to specific provider+voice pairs:

```jsonc
"polyvoice.languageMap": {
  "es": "elevenlabs:21m00Tcm4TlvDq8ikWAM",
  "ja": "azure:ja-JP-NanamiNeural"
}
```

### Caching

Identical selections aren't re-billed. Audio is cached on disk under your VS Code global storage, LRU-evicted at `polyvoice.cache.maxMB` (default 200 MB). Clear it any time with *Polyvoice: Clear Audio Cache*.

## Privacy

- Zero telemetry.
- Selected text is sent **only** to the provider you've chosen, using **your** API key.
- API keys live in VS Code `SecretStorage`. They are not written to `settings.json` and not synced.

## Build from source

```bash
git clone https://github.com/dorofino/polyvoice.git
cd polyvoice
npm install
npm run build
# Press F5 in VS Code to launch an Extension Development Host.
```

For the full developer + release workflow, see [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md).

## License

MIT — see [LICENSE](./LICENSE).

## Architecture

See [docs/ADR-001-architecture.md](./docs/ADR-001-architecture.md).
