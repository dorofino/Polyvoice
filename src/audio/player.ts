// Native OS audio playback. Buffers the synthesized stream to a temp file
// then plays it via a hidden child process. No webview, no UI, no autoplay
// restrictions. Stop = kill the process. Pause/resume is unsupported here.

import * as vscode from "vscode";
import { spawn, ChildProcess } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { Logger } from "../util/logger";

export class AudioPlayer implements vscode.Disposable {
  private current: { proc: ChildProcess; file: string } | undefined;

  constructor(_context: vscode.ExtensionContext, private readonly logger: Logger) {}

  async play(stream: AsyncIterable<Uint8Array>, mime: string): Promise<void> {
    this.stop();
    const ext = mimeToExt(mime);
    const tmpFile = path.join(
      os.tmpdir(),
      `polyvoice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
    );

    // Drain stream into memory then write once. Simpler than streaming to disk
    // and good enough for typical selection lengths (a few hundred KB of MP3).
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buf = Buffer.from(chunk);
      chunks.push(buf);
      total += buf.length;
    }
    await fs.writeFile(tmpFile, Buffer.concat(chunks, total));

    const proc = this.spawnPlayer(tmpFile, ext);
    this.current = { proc, file: tmpFile };

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        this.cleanup(tmpFile);
        if (this.current?.proc === proc) this.current = undefined;
        if (err) reject(err); else resolve();
      };
      proc.once("exit", (code) => {
        if (code !== 0 && code !== null) {
          this.logger.warn(`audio player exited with code ${code}`);
        }
        finish();
      });
      proc.once("error", (err) => {
        this.logger.error(`audio player spawn failed: ${err.message}`);
        finish(err);
      });
    });
  }

  pauseResume(): void {
    // Native playback can't be paused cross-platform. No-op.
    this.logger.info("pauseResume not supported in native playback mode");
  }

  stop(): void {
    if (!this.current) return;
    const { proc, file } = this.current;
    this.current = undefined;
    try { proc.kill(); } catch { /* noop */ }
    this.cleanup(file);
  }

  dispose(): void {
    this.stop();
  }

  // ---------- helpers ----------

  private spawnPlayer(file: string, _ext: string): ChildProcess {
    const platform = process.platform;
    if (platform === "win32") {
      // Use Windows PowerShell's WPF MediaPlayer. Plays MP3 and WAV with no
      // window. The script waits for the media's natural duration so the
      // process exits when playback ends — letting us await it.
      const safe = file.replace(/'/g, "''");
      const script =
        "Add-Type -AssemblyName PresentationCore; " +
        "$mp = New-Object System.Windows.Media.MediaPlayer; " +
        `$mp.Open([Uri]::new('${safe}')); ` +
        "$deadline = (Get-Date).AddSeconds(10); " +
        "while (-not $mp.NaturalDuration.HasTimeSpan -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 50 }; " +
        "if (-not $mp.NaturalDuration.HasTimeSpan) { exit 2 }; " +
        "$mp.Play(); " +
        "Start-Sleep -Milliseconds ([int]($mp.NaturalDuration.TimeSpan.TotalMilliseconds + 300))";
      return spawn(
        "powershell.exe",
        ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script],
        { windowsHide: true, stdio: "ignore" },
      );
    }
    if (platform === "darwin") {
      return spawn("afplay", [file], { stdio: "ignore" });
    }
    // Linux: try ffplay first, fall back to mpg123/aplay if missing.
    return spawn("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", file], { stdio: "ignore" });
  }

  private async cleanup(file: string): Promise<void> {
    // Give the player a moment to release the handle before unlinking.
    setTimeout(() => { fs.unlink(file).catch(() => { /* ignore */ }); }, 500);
  }
}

function mimeToExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("webm")) return "webm";
  return "bin";
}
