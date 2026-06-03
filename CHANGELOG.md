# Changelog

All notable changes to Polyvoice will be documented in this file.

## [0.1.19] - 2026-06-03

- Fix misleading timeout message when polyvoice.azure.endpoint is set
## [0.1.18] - 2026-06-03

- Add polyvoice.azure.endpoint setting for custom-subdomain Cognitive Services resources (corp VPN / private endpoint scenarios). Uses SpeechConfig.fromHost so traffic stays on whitelisted cognitiveservices.azure.com host.
## [0.1.17] - 2026-06-03

- Diagnose silent Azure failures: SDK event tracing and 15s first-byte timeout
## [0.1.16] - 2026-06-03

- Surface silent Azure errors: timeout + zero-bytes guard, comprehensive provider/player logging, new Polyvoice: Show Logs command, Show Logs button on error toasts
## [0.1.15] - 2026-05-29

- Add release pipeline script; slim VSIX (1198 -> ~306 files, 2.3MB -> 533KB)
## [0.1.0] — 2026-05-27

Initial scaffold.

- Provider abstraction (`TtsProvider`) with a registry.
- Native OS TTS provider (macOS `say`, Windows SAPI via PowerShell, Linux `spd-say`).
- OpenAI, ElevenLabs, Azure AI Foundry, xAI Grok provider stubs.
- Streaming webview audio player.
- Commands: speak selection, speak document, stop, pause/resume, select provider, select voice, set API key, export to audio, clear cache.
- Default keybindings: `Ctrl+Alt+S` / `Cmd+Alt+S` to speak selection.
- Editor context-menu entries.
- Status bar item showing active provider and voice.
- Secret storage for API keys.
- Disk cache with LRU eviction.
- Markdown-aware text extraction.
