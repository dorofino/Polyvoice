# ADR-001: Polyvoice — multi-provider read-aloud extension for VS Code

**Status:** Accepted
**Date:** 2026-05-27
**Deciders:** Diego Rofino (owner)

## Context

Diego wants a simple VS Code extension that reads aloud whatever text is selected, triggered by a keyboard shortcut or a right-click menu entry. The differentiator from the dozen extensions already on the marketplace (VS Code Speech, Eloquent, Speechify, Read Aloud Text, Text2Speech, ElevenLabs TTS, CX AI Voice Reader, etc.) is **first-class support for multiple TTS providers in a single extension**: the user's OS, OpenAI, Azure AI Foundry Speech, ElevenLabs, and xAI Grok TTS, all swappable at runtime with the user's own API keys.

### Forces

- **Crowded market.** Existing extensions each lock you into one engine. Owning "every voice provider, your key" is a real positioning gap.
- **Latency matters.** A read-aloud action that takes 2s to start feels broken. Native OS TTS is instant. Cloud providers stream — first audio chunk in 75ms (ElevenLabs Flash) to ~600ms (OpenAI). We must stream, never wait for full synthesis.
- **Cost varies wildly.** Native is free. OpenAI gpt-4o-mini-tts is ~$0.015/min. xAI is $4.20/M chars. Azure is $15/M chars. ElevenLabs is the most expensive but highest quality. The user pays directly via their own keys — we never proxy.
- **Security.** API keys must live in VS Code's `SecretStorage`, never in `settings.json`.
- **Cross-platform.** macOS, Windows, Linux. Native TTS engines differ (`say`, SAPI via PowerShell, `espeak-ng` / `spd-say`). Audio playback also differs.
- **Marketplace constraints.** Extensions can't ship native binaries easily. Cloud playback must work with pure Node + a webview audio element.

### Non-functional requirements

| Requirement | Target |
|---|---|
| Time-to-first-audio (native) | < 100 ms |
| Time-to-first-audio (cloud, streaming) | < 800 ms p95 |
| Bundle size (extension only) | < 2 MB |
| Cold-start activation cost | < 50 ms (lazy-load providers) |
| Privacy | Zero telemetry by default; selected text never logged |

## Decision

Build **Polyvoice** as a TypeScript VS Code extension with:

1. A small core that registers commands, keybindings, context-menu entries, a status bar item, and a webview-based audio player.
2. A **provider plugin interface** (`TtsProvider`) implemented per backend. Providers are lazy-loaded on first use to keep activation fast.
3. **Streaming-first** audio path: providers return an `AsyncIterable<Uint8Array>` of audio chunks. The player feeds them to a `MediaSource` in a hidden webview so playback begins on the first chunk.
4. **VS Code `SecretStorage`** for every API key. Settings hold only non-secret config (default provider, voice, rate, cache TTL).
5. **Content-addressed disk cache** keyed by `sha256(text + provider + voice + options)` so repeated selections don't re-bill.
6. **Markdown-aware text extraction** that optionally strips fenced code, links, and HTML before synthesis.
7. **MIT license, OSS, BYO key.** Free forever, ships through the Visual Studio Marketplace and Open VSX.

## Options considered

### Option A — Single-provider extension (chosen-engine)

Pick one engine (e.g. ElevenLabs only) and ship.

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | Low |
| Differentiation | None — already done six ways |
| Scalability | Low — can't add providers without rewriting |
| Team familiarity | High |

**Pros:** Fastest to ship. Less abstraction.
**Cons:** No reason for a user to pick this over the incumbent. Provider lock-in.

### Option B — Multi-provider via plugin interface (chosen)

Core extension + `TtsProvider` interface + one implementation per backend, all behind a unified UX.

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost | Medium |
| Differentiation | High — no other extension does this end-to-end |
| Scalability | High — adding a new engine is a single file |
| Team familiarity | High (TypeScript / VS Code API) |

**Pros:** Owns a real positioning gap. Future providers (Google, Deepgram, Cartesia, Inworld) are one file each. Users can mix engines per language or per file type.
**Cons:** More surface area to test. Per-provider quirks (auth flows, voice IDs, audio formats) must be normalized.

### Option C — Proxy server in the middle

Run a hosted backend that brokers keys and bills via Stripe.

| Dimension | Assessment |
|---|---|
| Complexity | High |
| Cost | High (infra + billing + support) |
| Differentiation | High but at a price |
| Scalability | High |
| Team familiarity | Medium |

**Pros:** Lets us monetize.
**Cons:** Requires running a service, a payments stack, and shouldering provider TOS for end users. Out of scope for v0/v1.

## Trade-off analysis

**B vs A:** A ships in a weekend but adds nothing the market needs. B adds maybe a week of work for a real reason to exist. Pick B.

**B vs C:** C is the right answer if we want a business; B is the right answer if we want a useful, well-loved tool. Diego framed this as "a simple and useful extension," so build B now and revisit C only if user demand pulls us there.

**Streaming vs full-file synthesis:** Full-file is simpler (one HTTP call → one audio file → play) but adds 1–3 s of perceived latency for paragraph-length selections. Streaming-via-`MediaSource` is well-supported in VS Code's Chromium webview and turns the perceived gap into ~300 ms. Worth the extra code.

**Webview player vs spawn-an-audio-tool:** Native players (`afplay`, `paplay`, PowerShell `Media.SoundPlayer`) don't stream MP3 chunks portably and give us no progress events. The webview gives us streaming, pause/resume, seek, and word-by-word highlighting via `currentTime` events in one place. Webview wins.

**Cache key includes options:** Audio differs by rate/pitch/voice — collapsing those into the key would serve wrong audio. Worth the longer key.

## Architecture

```
+-----------------------------+        +-----------------------------+
|   Editor (selection, MD)    |        |    VS Code SecretStorage    |
+--------------+--------------+        +--------------+--------------+
               |                                      |
               v                                      v
+-----------------------------+        +-----------------------------+
|   Text extractor + cleaner  |        |       Key & config layer    |
+--------------+--------------+        +--------------+--------------+
               |                                      |
               v                                      v
        +--------------------------------------------------+
        |              TtsProvider registry                |
        |   native | openai | azure | elevenlabs | xai     |
        +-----------------+--------------------------------+
                          |
            AsyncIterable<Uint8Array>
                          v
        +--------------------------------------------------+
        |   Disk cache (sha256 → .mp3 / .wav)              |
        +-----------------+--------------------------------+
                          |
                          v
        +--------------------------------------------------+
        |   Webview audio player (MediaSource streaming)   |
        |   pause / resume / stop / seek / word highlight  |
        +-----------------+--------------------------------+
                          |
                          v
                  +---------------+
                  | Status bar UI |
                  +---------------+
```

### The `TtsProvider` contract

```ts
export interface TtsProvider {
  readonly id: string;            // "openai" | "azure" | ...
  readonly displayName: string;

  listVoices(): Promise<Voice[]>;
  synthesize(
    text: string,
    opts: SynthesizeOptions,
    signal: AbortSignal,
  ): AsyncIterable<Uint8Array>;   // streaming audio bytes

  readonly audio: { mime: string; sampleRate?: number };
  readonly needsApiKey: boolean;
}
```

Every provider exposes the same surface. The core never knows about provider quirks.

### Provider notes

| Provider | Endpoint | Format | Notes |
|---|---|---|---|
| `native` | `child_process` (`say` / PowerShell / `spd-say`) | wav pipe | No key. Zero cost. Default on first install. |
| `openai` | `POST /v1/audio/speech` (`gpt-4o-mini-tts`) | mp3 stream | `~$0.015/min`, 13 voices, 300–600 ms TTFA. |
| `elevenlabs` | `POST /v1/text-to-speech/{voice}/stream` (`eleven_flash_v2_5`) | mp3 stream | 75 ms TTFA on Flash, highest quality on v2. |
| `azure` | `wss://.../tts/cognitiveservices/websocket/v2` via `microsoft-cognitiveservices-speech-sdk` | wav stream | 400+ voices, 140+ languages, $15/M chars standard. |
| `xai` | `POST /v1/audio/speech` | mp3 stream | $4.20/M chars, 5 voices. Launched 2026-03-16. |

### Commands

| Command ID | Default keybinding | Menu |
|---|---|---|
| `polyvoice.speakSelection` | `Ctrl+Alt+S` / `Cmd+Alt+S` | Editor right-click |
| `polyvoice.speakDocument` | — | Command palette |
| `polyvoice.stop` | `Ctrl+Alt+X` / `Cmd+Alt+X` | Status bar |
| `polyvoice.pauseResume` | `Ctrl+Alt+P` / `Cmd+Alt+P` | Status bar |
| `polyvoice.selectProvider` | — | Status bar |
| `polyvoice.selectVoice` | — | Status bar |
| `polyvoice.setApiKey` | — | Command palette |
| `polyvoice.exportSelectionToAudio` | — | Command palette |
| `polyvoice.clearCache` | — | Command palette |

### Configuration (non-secret only)

```jsonc
{
  "polyvoice.provider": "native",                 // active provider id
  "polyvoice.voice": "",                          // provider-scoped voice id
  "polyvoice.rate": 1.0,                          // 0.5–2.0
  "polyvoice.cache.enabled": true,
  "polyvoice.cache.maxMB": 200,
  "polyvoice.markdown.skipCodeBlocks": true,
  "polyvoice.languageMap": {                      // optional per-language voice overrides
    "es": "elevenlabs:21m00Tcm4TlvDq8ikWAM",
    "ja": "azure:ja-JP-NanamiNeural"
  }
}
```

## Consequences

**What becomes easier**
- Adding a 6th provider (Google, Deepgram, Cartesia) is one file plus one registry line.
- Users get a single UX they learn once.
- Tests can mock the `TtsProvider` interface for the core, and each provider can be tested independently.

**What becomes harder**
- Voice picker UI must normalize five different voice catalogs.
- Streaming MP3 vs WAV must be tagged correctly per provider so `MediaSource` picks the right MIME.
- Cross-platform native TTS is fiddly — Linux distros vary.

**What we'll need to revisit**
- Caching strategy if users frequently rotate voices (cache could grow fast — LRU evict).
- Whether to fall back from cloud → native on network failure (probably yes, behind a setting).
- Monetization (Option C) if/when we have meaningful adoption.

## Action items

1. [ ] Scaffold the project (`package.json`, `tsconfig.json`, `esbuild`, VS Code launch config).
2. [ ] Implement `TtsProvider` interface + registry.
3. [ ] Ship `native` provider end-to-end as the first vertical slice.
4. [ ] Implement webview audio player with `MediaSource` streaming.
5. [ ] Wire commands, keybindings, context menu, status bar.
6. [ ] Implement OpenAI provider (lowest friction cloud, smallest SDK footprint).
7. [ ] Implement ElevenLabs, Azure, xAI providers.
8. [ ] Implement disk cache.
9. [ ] Write README, screenshots, gif demo.
10. [ ] Publish to Marketplace + Open VSX.
