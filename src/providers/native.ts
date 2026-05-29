// Native OS TTS provider.
// macOS: spawns `say` and pipes WAV to stdout.
// Windows: invokes System.Speech.Synthesis through PowerShell and pipes WAV.
// Linux:  spawns `spd-say` if present, else `espeak-ng`. Falls back to a clear error.

import { spawn } from "node:child_process";
import * as os from "node:os";
import type { TtsProvider, Voice, SynthesizeOptions } from "./types";
import { ProviderError } from "./types";
import type { Logger } from "../util/logger";

export class NativeProvider implements TtsProvider {
  readonly id = "native";
  readonly displayName = "Native OS TTS";
  readonly needsApiKey = false;
  readonly audio = { mime: "audio/wav" as const };

  constructor(private readonly logger: Logger) {}

  async listVoices(): Promise<Voice[]> {
    const platform = os.platform();
    try {
      if (platform === "darwin") return await this.listMacVoices();
      if (platform === "win32")  return await this.listWindowsVoices();
      return await this.listLinuxVoices();
    } catch (err) {
      this.logger.warn(`native listVoices failed: ${(err as Error).message}`);
      return [];
    }
  }

  // Native providers play directly through the OS audio device — no audio bytes
  // come back to the extension. The core skips the webview player entirely
  // when a provider implements speak() instead of synthesize().
  async speak(text: string, opts: SynthesizeOptions, signal: AbortSignal): Promise<void> {
    const platform = os.platform();
    const child = platform === "darwin"  ? this.spawnMac(text, opts)
                : platform === "win32"   ? this.spawnWindows(text, opts)
                :                          this.spawnLinux(text, opts);

    const onAbort = () => child.kill();
    signal.addEventListener("abort", onAbort);

    try {
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => {
          if (code === 0 || signal.aborted) resolve();
          else reject(new ProviderError(`native TTS exited with code ${code}`, this.id));
        });
      });
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  // ---------- platform helpers ----------

  private spawnMac(text: string, opts: SynthesizeOptions) {
    // No -o flag → speaks directly through the default audio device.
    const args = ["-r", String(Math.round((opts.rate ?? 1) * 175))];
    if (opts.voice) args.push("-v", opts.voice);
    const child = spawn("say", args, { stdio: ["pipe", "ignore", "pipe"] });
    child.stdin.end(text);
    return child;
  }

  private spawnWindows(text: string, opts: SynthesizeOptions) {
    // SetOutputToDefaultAudioDevice → SpeechSynthesizer plays through the speakers.
    // Pass text via stdin (UTF-8) to avoid quoting issues with newlines / special chars.
    const script = [
      "$OutputEncoding = [Console]::InputEncoding = [System.Text.Encoding]::UTF8;",
      "Add-Type -AssemblyName System.Speech;",
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
      "$s.SetOutputToDefaultAudioDevice();",
      opts.voice ? `$s.SelectVoice('${opts.voice.replace(/'/g, "''")}');` : "",
      `$s.Rate = ${Math.max(-10, Math.min(10, Math.round(((opts.rate ?? 1) - 1) * 10)))};`,
      "$txt = [Console]::In.ReadToEnd();",
      "$s.Speak($txt);",
    ].filter(Boolean).join(" ");
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", script], { stdio: ["pipe", "ignore", "pipe"] });
    child.stdin.end(text);
    return child;
  }

  private spawnLinux(text: string, _opts: SynthesizeOptions) {
    // spd-say plays directly through the default audio device and blocks with --wait.
    return spawn("spd-say", ["--wait", text], { stdio: ["ignore", "ignore", "pipe"] });
  }

  private async listMacVoices(): Promise<Voice[]> {
    const out = await execCapture("say", ["-v", "?"]);
    const voices: Voice[] = [];
    for (const line of out.split("\n")) {
      const m = line.match(/^(\S+)\s+([a-z]{2}_[A-Z]{2})\s+#\s*(.*)$/);
      if (m) voices.push({ id: m[1], name: m[1], locale: m[2].replace("_", "-") });
    }
    return voices;
  }

  private async listWindowsVoices(): Promise<Voice[]> {
    const script = "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }";
    const out = await execCapture("powershell.exe", ["-NoProfile", "-Command", script]);
    return out.split(/\r?\n/).filter(Boolean).map((name) => ({ id: name, name }));
  }

  private async listLinuxVoices(): Promise<Voice[]> {
    const out = await execCapture("espeak-ng", ["--voices"]);
    const voices: Voice[] = [];
    for (const line of out.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5) voices.push({ id: parts[3], name: parts[3], locale: parts[1] });
    }
    return voices;
  }
}

function execCapture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve(Buffer.concat(chunks).toString("utf8")) : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}
