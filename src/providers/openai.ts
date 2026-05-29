// OpenAI gpt-4o-mini-tts provider.
// Streams MP3 via POST /v1/audio/speech. First chunk arrives in ~300-600ms.

import * as vscode from "vscode";
import type { TtsProvider, Voice, SynthesizeOptions } from "./types";
import { ProviderError } from "./types";
import type { SecretsManager } from "../util/secrets";
import type { Logger } from "../util/logger";

const DEFAULT_VOICES: Voice[] = [
  { id: "alloy",   name: "Alloy" },
  { id: "ash",     name: "Ash" },
  { id: "ballad",  name: "Ballad" },
  { id: "coral",   name: "Coral" },
  { id: "echo",    name: "Echo" },
  { id: "fable",   name: "Fable" },
  { id: "onyx",    name: "Onyx" },
  { id: "nova",    name: "Nova" },
  { id: "sage",    name: "Sage" },
  { id: "shimmer", name: "Shimmer" },
];

export class OpenAIProvider implements TtsProvider {
  readonly id = "openai";
  readonly displayName = "OpenAI (gpt-4o-mini-tts)";
  readonly needsApiKey = true;
  readonly audio = { mime: "audio/mpeg" as const };

  constructor(private readonly secrets: SecretsManager, _logger: Logger) {}

  async listVoices(): Promise<Voice[]> {
    return DEFAULT_VOICES;
  }

  async *synthesize(text: string, opts: SynthesizeOptions, signal: AbortSignal): AsyncIterable<Uint8Array> {
    const key = await this.secrets.require("openai");
    const cfg = vscode.workspace.getConfiguration("polyvoice");
    const baseUrl = cfg.get<string>("openai.baseUrl") || "https://api.openai.com/v1";
    const model = cfg.get<string>("openai.model") || "gpt-4o-mini-tts";

    const body = {
      model,
      voice: opts.voice || "alloy",
      input: text,
      response_format: "mp3",
      speed: opts.rate ?? 1.0,
    };

    const res = await fetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok || !res.body) {
      const detail = await safeText(res);
      throw new ProviderError(`OpenAI TTS ${res.status}: ${detail}`, this.id, res.status);
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
