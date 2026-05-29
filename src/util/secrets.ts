// Thin wrapper around VS Code's SecretStorage. Every API key lives here, never in settings.

import * as vscode from "vscode";

export class SecretsManager {
  constructor(private readonly storage: vscode.SecretStorage) {}

  key(providerId: string): string {
    return `polyvoice.apiKey.${providerId}`;
  }

  async get(providerId: string): Promise<string | undefined> {
    return this.storage.get(this.key(providerId));
  }

  async require(providerId: string): Promise<string> {
    const v = await this.get(providerId);
    if (!v) {
      const choice = await vscode.window.showWarningMessage(
        `No API key configured for ${providerId}. Set one now?`,
        "Set API Key",
      );
      if (choice === "Set API Key") {
        await vscode.commands.executeCommand("polyvoice.setApiKey", providerId);
        const after = await this.get(providerId);
        if (after) return after;
      }
      throw new Error(`Missing API key for ${providerId}`);
    }
    return v;
  }

  async set(providerId: string, value: string): Promise<void> {
    await this.storage.store(this.key(providerId), value);
  }

  async clear(providerId: string): Promise<void> {
    await this.storage.delete(this.key(providerId));
  }
}
