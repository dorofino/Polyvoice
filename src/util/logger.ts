// Output-channel logger. Nothing is sent off-device.

import * as vscode from "vscode";

export class Logger implements vscode.Disposable {
  private readonly channel: vscode.OutputChannel;

  constructor(name: string) {
    this.channel = vscode.window.createOutputChannel(name);
  }

  info(msg: string)  { this.write("INFO",  msg); }
  warn(msg: string)  { this.write("WARN",  msg); }
  error(msg: string) { this.write("ERROR", msg); }

  private write(level: string, msg: string): void {
    const ts = new Date().toISOString();
    this.channel.appendLine(`[${ts}] ${level} ${msg}`);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
