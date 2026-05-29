// xAI Grok TTS provider.
// Uses the REST endpoint POST /v1/tts.
// Docs: https://docs.x.ai/developers/rest-api-reference/inference/voice

import * as vscode from "vscode";
import type { TtsProvider, Voice, SynthesizeOptions } from "./types";
import { ProviderError } from "./types";
import type { SecretsManager } from "../util/secrets";
import type { Logger } from "../util/logger";

const VOICES: Voice[] = [
  { id: "eve", name: "Eve", gender: "female" },
  { id: "ara", name: "Ara", gender: "female" },
  { id: "rex", name: "Rex", gender: "male" },
  { id: "sal", name: "Sal", gender: "neutral" },
  { id: "leo", name: "Leo", gender: "male" },
];

export class XaiProvider implements TtsProvider {
  readonly id = "xai";
  readonly displayName = "xAI Grok TTS";
  readonly needsApiKey = true;
  readonly audio = { mime: "audio/mpeg" as const };

  constructor(private readonly secrets: SecretsManager, private readonly logger: Logger) {}

  async listVoices(): Promise<Voice[]> {
    const cfg = vscode.workspace.getConfiguration("polyvoice");
    const baseUrl = (cfg.get<string>("xai.baseUrl") || "https://api.x.ai/v1").replace(/\/+$/, "");
    try {
      const key = await this.secrets.require("xai");
      const res = await fetch(`${baseUrl}/tts/voices`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) {
        const json = await res.json() as { voices?: Array<{ voice_id: string; name: string; language?: string }> };
        if (json.voices?.length) {
          return json.voices.map((v) => ({ id: v.voice_id, name: v.name, locale: v.language }));
        }
      }
    } catch (err) {
      this.logger.warn(`xAI listVoices fallback: ${(err as Error).message}`);
    }
    return VOICES;
  }

  async *synthesize(text: string, opts: SynthesizeOptions, signal: AbortSignal): AsyncIterable<Uint8Array> {
    const key = await this.secrets.require("xai");
    const cfg = vscode.workspace.getConfiguration("polyvoice");
    const baseUrl = (cfg.get<string>("xai.baseUrl") || "https://api.x.ai/v1").replace(/\/+$/, "");
    const voice = opts.voice || cfg.get<string>("xai.voice") || "eve";
    const language = opts.locale?.split("-")[0] || cfg.get<string>("xai.language") || "auto";

    const body: Record<string, unknown> = {
      text,
      voice_id: voice,
      language,
    };
    if (opts.rate && opts.rate !== 1) body.speed = Math.max(0.7, Math.min(1.5, opts.rate));

    const res = await fetch(`${baseUrl}/tts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok || !res.body) {
      throw new ProviderError(`xAI ${res.status}: ${await safeText(res)}`, this.id, res.status);
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
