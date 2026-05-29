// ElevenLabs TTS provider.
// Uses /v1/text-to-speech/{voice_id}/stream with eleven_flash_v2_5 for low latency (~75ms TTFA).

import * as vscode from "vscode";
import type { TtsProvider, Voice, SynthesizeOptions } from "./types";
import { ProviderError } from "./types";
import type { SecretsManager } from "../util/secrets";
import type { Logger } from "../util/logger";

const FALLBACK_VOICE = "21m00Tcm4TlvDq8ikWAM"; // "Rachel" — the canonical ElevenLabs demo voice

export class ElevenLabsProvider implements TtsProvider {
  readonly id = "elevenlabs";
  readonly displayName = "ElevenLabs";
  readonly needsApiKey = true;
  readonly audio = { mime: "audio/mpeg" as const };

  constructor(private readonly secrets: SecretsManager, _logger: Logger) {}

  async listVoices(): Promise<Voice[]> {
    const key = await this.secrets.require("elevenlabs");
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": key },
    });
    if (!res.ok) throw new ProviderError(`ElevenLabs list voices ${res.status}`, this.id, res.status);
    const data = await res.json() as { voices: Array<{ voice_id: string; name: string; labels?: Record<string, string> }> };
    return data.voices.map((v) => ({
      id: v.voice_id,
      name: v.name,
      gender: (v.labels?.gender as Voice["gender"]) ?? undefined,
    }));
  }

  async *synthesize(text: string, opts: SynthesizeOptions, signal: AbortSignal): AsyncIterable<Uint8Array> {
    const key = await this.secrets.require("elevenlabs");
    const cfg = vscode.workspace.getConfiguration("polyvoice");
    const model = cfg.get<string>("elevenlabs.model") || "eleven_flash_v2_5";
    const format = cfg.get<string>("elevenlabs.outputFormat") || "mp3_44100_128";
    const voice = opts.voice || FALLBACK_VOICE;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=${encodeURIComponent(format)}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      throw new ProviderError(`ElevenLabs ${res.status}: ${await safeText(res)}`, this.id, res.status);
    }
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return res.statusText; }
}
