// Azure AI Foundry Speech provider.
// Uses the official Speech SDK with PullAudioOutputStream so we can yield chunks as they arrive.

import * as vscode from "vscode";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import type { TtsProvider, Voice, SynthesizeOptions } from "./types";
import { ProviderError } from "./types";
import type { SecretsManager } from "../util/secrets";
import type { Logger } from "../util/logger";

export class AzureProvider implements TtsProvider {
  readonly id = "azure";
  readonly displayName = "Azure AI Foundry Speech";
  readonly needsApiKey = true;
  readonly audio = { mime: "audio/mpeg" as const };

  constructor(private readonly secrets: SecretsManager, _logger: Logger) {}

  async listVoices(): Promise<Voice[]> {
    const key = await this.secrets.require("azure");
    const region = vscode.workspace.getConfiguration("polyvoice").get<string>("azure.region") || "eastus";
    const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
      headers: { "Ocp-Apim-Subscription-Key": key },
    });
    if (!res.ok) throw new ProviderError(`Azure voices ${res.status}`, this.id, res.status);
    const list = await res.json() as Array<{ ShortName: string; DisplayName: string; Locale: string; Gender: string }>;
    return list.map((v) => ({
      id: v.ShortName,
      name: `${v.DisplayName} (${v.Locale})`,
      locale: v.Locale,
      gender: v.Gender?.toLowerCase() as Voice["gender"],
    }));
  }

  async *synthesize(text: string, opts: SynthesizeOptions, signal: AbortSignal): AsyncIterable<Uint8Array> {
    const key = await this.secrets.require("azure");
    const region = vscode.workspace.getConfiguration("polyvoice").get<string>("azure.region") || "eastus";

    const config = sdk.SpeechConfig.fromSubscription(key, region);
    config.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
    const voice = opts.voice || vscode.workspace.getConfiguration("polyvoice").get<string>("azure.voice") || "en-US-AvaMultilingualNeural";
    config.speechSynthesisVoiceName = voice;

    const pull = sdk.AudioOutputStream.createPullStream();
    const audioCfg = sdk.AudioConfig.fromStreamOutput(pull);
    const synth = new sdk.SpeechSynthesizer(config, audioCfg);
    const ssml = buildSsml(text, voice, opts.rate ?? 1, opts.locale);

    const done = new Promise<void>((resolve, reject) => {
      synth.speakSsmlAsync(
        ssml,
        (result) => {
          if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) {
            reject(new ProviderError(`Azure synth: ${result.errorDetails ?? result.reason}`, this.id));
          } else {
            resolve();
          }
          synth.close();
        },
        (err) => { synth.close(); reject(new ProviderError(`Azure synth error: ${err}`, this.id)); },
      );
    });

    const onAbort = () => synth.close();
    signal.addEventListener("abort", onAbort);

    try {
      const buf = new ArrayBuffer(8 * 1024);
      while (true) {
        const n = await pull.read(buf);
        if (n === 0) break;
        yield new Uint8Array(buf.slice(0, n));
      }
      await done;
    } finally {
      signal.removeEventListener("abort", onAbort);
      pull.close();
    }
  }
}

function buildSsml(text: string, voice: string | undefined, rate: number, locale: string | undefined): string {
  const lang = locale || "en-US";
  const v = voice || "en-US-AvaMultilingualNeural";
  const prosodyRate = rate === 1 ? "default" : `${Math.round((rate - 1) * 100)}%`;
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<speak version='1.0' xml:lang='${lang}'><voice name='${v}'><prosody rate='${prosodyRate}'>${escaped}</prosody></voice></speak>`;
}
