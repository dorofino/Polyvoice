# Changelog

All notable changes to Polyvoice will be documented in this file.

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
