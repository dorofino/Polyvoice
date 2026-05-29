// Shared provider contract. Every TTS backend implements this surface.
// The core never branches on provider id; it talks to TtsProvider only.

export interface Voice {
  id: string;
  name: string;
  locale?: string;       // BCP-47, e.g. "en-US"
  gender?: "male" | "female" | "neutral";
  preview?: string;      // optional URL with a sample
}

export interface SynthesizeOptions {
  voice?: string;        // provider-scoped voice id; empty = provider default
  rate?: number;         // 0.5–2.0, normalized per provider
  pitch?: number;        // -1.0 to 1.0
  format?: "mp3" | "wav" | "ogg";
  locale?: string;       // for language-aware providers
}

export interface AudioInfo {
  mime: string;          // "audio/mpeg" | "audio/wav" | ...
  sampleRate?: number;
}

export interface TtsProvider {
  readonly id: string;
  readonly displayName: string;
  readonly needsApiKey: boolean;
  readonly audio: AudioInfo;

  listVoices(): Promise<Voice[]>;

  /**
   * Stream audio bytes. Implemented by cloud providers that return raw
   * audio (MP3/WebM/etc) suitable for the webview MediaSource player.
   * Mutually exclusive with speak() — a provider implements one or the other.
   */
  synthesize?(
    text: string,
    opts: SynthesizeOptions,
    signal: AbortSignal,
  ): AsyncIterable<Uint8Array>;

  /**
   * Speak directly through the OS audio device. Implemented by native
   * providers (macOS say, Windows SpeechSynthesizer, Linux spd-say) that
   * play through the speakers themselves — no audio bytes need to flow
   * back to the extension. When a provider implements speak(), the core
   * does not open the webview player.
   */
  speak?(
    text: string,
    opts: SynthesizeOptions,
    signal: AbortSignal,
  ): Promise<void>;
}

export class ProviderError extends Error {
  constructor(message: string, public readonly providerId: string, public readonly status?: number) {
    super(message);
    this.name = "ProviderError";
  }
}
