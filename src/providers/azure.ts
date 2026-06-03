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

  constructor(private readonly secrets: SecretsManager, private readonly logger: Logger) {}

  async listVoices(): Promise<Voice[]> {
    const key = await this.secrets.require("azure");
    const region = vscode.workspace.getConfiguration("polyvoice").get<string>("azure.region") || "eastus";
    this.logger.info(`azure: listVoices region=${region}`);
    const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
      headers: { "Ocp-Apim-Subscription-Key": key },
    });
    if (!res.ok) {
      this.logger.error(`azure: listVoices HTTP ${res.status} ${res.statusText}`);
      throw new ProviderError(`Azure voices ${res.status}`, this.id, res.status);
    }
    const list = await res.json() as Array<{ ShortName: string; DisplayName: string; Locale: string; Gender: string }>;
    this.logger.info(`azure: listVoices ok, ${list.length} voices`);
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

    this.logger.info(`azure: synth start region=${region} voice=${voice} len=${text.length} chars`);

    const pull = sdk.AudioOutputStream.createPullStream();
    const audioCfg = sdk.AudioConfig.fromStreamOutput(pull);
    const synth = new sdk.SpeechSynthesizer(config, audioCfg);
    const ssml = buildSsml(text, voice, opts.rate ?? 1, opts.locale);

    // Verbose SDK event tracing so we can see what's happening when nothing plays.
    synth.synthesisStarted = (_s, _e) => this.logger.info("azure: event synthesisStarted");
    synth.synthesizing = (_s, e) => this.logger.info(`azure: event synthesizing (+${e.result.audioData?.byteLength ?? 0} bytes)`);
    synth.synthesisCompleted = (_s, e) => this.logger.info(`azure: event synthesisCompleted total=${e.result.audioData?.byteLength ?? 0} reason=${e.result.reason}`);
    synth.SynthesisCanceled = (_s, e) => {
      let detail = "";
      try {
        const c = sdk.CancellationDetails.fromResult(e.result);
        detail = `reason=${c.reason} code=${c.ErrorCode} details=${c.errorDetails}`;
      } catch { detail = `reason=${e.result.reason} errorDetails=${e.result.errorDetails}`; }
      this.logger.error(`azure: event SynthesisCanceled ${detail}`);
    };

    let synthError: Error | undefined;
    let synthDone = false;
    const done = new Promise<void>((resolve, reject) => {
      synth.speakSsmlAsync(
        ssml,
        (result) => {
          synthDone = true;
          if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) {
            // Try to get the richer Cancellation details for bad-key / unsupported-voice cases.
            let detail = result.errorDetails ?? `reason=${result.reason}`;
            try {
              const cancel = sdk.CancellationDetails.fromResult(result as sdk.SpeechSynthesisResult);
              detail = `${cancel.reason} ${cancel.ErrorCode} ${cancel.errorDetails || detail}`;
            } catch { /* not cancellable */ }
            synthError = new ProviderError(`Azure synth failed: ${detail}`, this.id);
            this.logger.error(`azure: ${synthError.message}`);
            reject(synthError);
          } else {
            this.logger.info(`azure: synth callback complete (${result.audioData?.byteLength ?? "?"} bytes total)`);
            resolve();
          }
          synth.close();
        },
        (err) => {
          synthDone = true;
          synthError = new ProviderError(`Azure synth error: ${err}`, this.id);
          this.logger.error(`azure: ${synthError.message}`);
          synth.close();
          reject(synthError);
        },
      );
    });
    // Swallow unhandled-rejection noise; we handle the error explicitly below.
    done.catch(() => { /* handled */ });

    const onAbort = () => { this.logger.info("azure: synth aborted"); synth.close(); };
    signal.addEventListener("abort", onAbort);

    let yielded = 0;
    let firstByteSeen = false;
    const FIRST_BYTE_TIMEOUT_MS = 15000;
    try {
      const buf = new ArrayBuffer(8 * 1024);
      while (true) {
        // First-byte timeout: if the SDK never produces audio AND never calls
        // the completion callback (happens with bad regions / network issues),
        // pull.read() will hang forever. Race it against a timeout.
        const readPromise = pull.read(buf);
        const n: number = firstByteSeen
          ? await readPromise
          : await Promise.race([
              readPromise,
              new Promise<number>((_, rej) => setTimeout(
                () => rej(new ProviderError(
                  `Azure produced no audio within ${FIRST_BYTE_TIMEOUT_MS / 1000}s. Likely causes: network/proxy blocking wss://${region}.tts.speech.microsoft.com, invalid key, or wrong region. Check Polyvoice output channel for SDK events.`,
                  this.id,
                )),
                FIRST_BYTE_TIMEOUT_MS,
              )),
            ]);
        if (n === 0) break;
        if (!firstByteSeen) {
          firstByteSeen = true;
          this.logger.info(`azure: first audio byte arrived (${n} bytes)`);
        }
        yielded += n;
        yield new Uint8Array(buf.slice(0, n));
      }
      // Wait for the synth callback to fire so we surface real errors.
      // Don't wait forever — the SDK can close the stream without ever calling
      // the callback (bad region, network drop, etc.).
      if (!synthDone) {
        await Promise.race([
          done,
          new Promise<void>((_, rej) => setTimeout(
            () => rej(new ProviderError("Azure synth timed out waiting for completion callback", this.id)),
            5000,
          )),
        ]);
      } else if (synthError) {
        throw synthError;
      }
      if (yielded === 0 && !synthError) {
        throw new ProviderError(
          "Azure returned 0 audio bytes. Common causes: invalid key, wrong region, voice not deployed in this region, or quota exhausted. Check Polyvoice output channel for details.",
          this.id,
        );
      }
      this.logger.info(`azure: yielded ${yielded} bytes`);
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
