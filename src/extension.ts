// Polyvoice — VS Code extension entry point.
// Wires commands, keybindings, context-menu entries, the status bar item,
// and the streaming audio player. Providers are lazy-loaded on first use.

import * as vscode from "vscode";
import { ProviderRegistry } from "./providers";
import { AudioPlayer } from "./audio/player";
import { StatusBar } from "./status/statusBar";
import { extractFromSelection, extractFromDocument } from "./text/extractor";
import { AudioCache } from "./cache";
import { SecretsManager } from "./util/secrets";
import { Logger } from "./util/logger";
import { registerCommands } from "./commands";

let registry: ProviderRegistry;
let player: AudioPlayer;
let status: StatusBar;
let cache: AudioCache;
let secrets: SecretsManager;
let logger: Logger;

export function activate(context: vscode.ExtensionContext): void {
  logger = new Logger("Polyvoice");
  secrets = new SecretsManager(context.secrets);
  cache = new AudioCache(context.globalStorageUri, logger);
  registry = new ProviderRegistry(secrets, logger);
  player = new AudioPlayer(context, logger);
  status = new StatusBar();
  status.refresh();

  context.subscriptions.push(
    logger,
    player,
    status,
    ...registerCommands({
      registry,
      player,
      status,
      cache,
      secrets,
      logger,
      extractFromSelection,
      extractFromDocument,
    }),
  );

  logger.info("Polyvoice activated");
}

export function deactivate(): void {
  player?.stop();
}
