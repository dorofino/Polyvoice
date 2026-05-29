// Command wiring. Each command is a thin handler that pulls config + active text,
// resolves a provider, and pushes the stream into the player.

import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import type { ProviderRegistry, ProviderId } from "../providers";
import type { AudioPlayer } from "../audio/player";
import type { StatusBar } from "../status/statusBar";
import type { AudioCache } from "../cache";
import type { SecretsManager } from "../util/secrets";
import type { Logger } from "../util/logger";
import type { Extraction } from "../text/extractor";

interface Deps {
  registry: ProviderRegistry;
  player: AudioPlayer;
  status: StatusBar;
  cache: AudioCache;
  secrets: SecretsManager;
  logger: Logger;
  extractFromSelection(editor: vscode.TextEditor): Extraction | undefined;
  extractFromDocument(editor: vscode.TextEditor): Extraction | undefined;
}

export function registerCommands(d: Deps): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("polyvoice.readAloud",              () => speak(d, "auto")),
    vscode.commands.registerCommand("polyvoice.speakSelection",         () => speak(d, "selection")),
    vscode.commands.registerCommand("polyvoice.speakClipboard",         () => speakClipboard(d)),
    vscode.commands.registerCommand("polyvoice.speakDocument",          () => speak(d, "document")),
    vscode.commands.registerCommand("polyvoice.stop",                   () => { d.player.stop(); d.status.refresh("idle"); }),
    vscode.commands.registerCommand("polyvoice.pauseResume",            () => d.player.pauseResume()),
    vscode.commands.registerCommand("polyvoice.selectProvider",         () => selectProvider(d)),
    vscode.commands.registerCommand("polyvoice.selectVoice",            () => selectVoice(d)),
    vscode.commands.registerCommand("polyvoice.setApiKey",              (id?: ProviderId) => setApiKey(d, id)),
    vscode.commands.registerCommand("polyvoice.setOpenAIKey",           () => setApiKey(d, "openai")),
    vscode.commands.registerCommand("polyvoice.setElevenLabsKey",       () => setApiKey(d, "elevenlabs")),
    vscode.commands.registerCommand("polyvoice.setAzureKey",            () => setApiKey(d, "azure")),
    vscode.commands.registerCommand("polyvoice.setXaiKey",              () => setApiKey(d, "xai")),
    vscode.commands.registerCommand("polyvoice.exportSelectionToAudio", () => exportSelection(d)),
    vscode.commands.registerCommand("polyvoice.clearCache",             () => clearCache(d)),
    vscode.commands.registerCommand("polyvoice.configureShortcuts",      () => configureShortcuts()),
    vscode.commands.registerCommand("polyvoice.quickMenu",               () => quickMenu(d)),
  ];
}

async function speak(d: Deps, mode: "selection" | "document" | "auto"): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  let text: string | undefined;
  let languageId: string | undefined;

  if (editor) {
    const ex = mode === "selection" ? d.extractFromSelection(editor)
             : mode === "document"  ? d.extractFromDocument(editor)
             : (d.extractFromSelection(editor) ?? d.extractFromDocument(editor));
    text = ex?.text;
    languageId = ex?.languageId;
  }

  // Fallback for non-editor surfaces (Extensions view, Copilot Chat, Welcome page,
  // Markdown preview, settings UI, terminal, etc.): first try the universal copy
  // command (works in editors); if that yields nothing, just speak whatever is
  // already on the clipboard.
  if (!text && mode !== "document") {
    text = await grabSelectionViaClipboard(d.logger);
  }

  if (!text) {
    vscode.window.showInformationMessage(
      "Polyvoice: nothing to read. Select text in an editor, or press Ctrl+C to copy text from any view first, then try again.",
    );
    return;
  }

  const cfg = vscode.workspace.getConfiguration("polyvoice");
  const providerId = (cfg.get<string>("provider") || "native") as ProviderId;
  const voice = cfg.get<string>("voice") || "";
  const rate = cfg.get<number>("rate") ?? 1.0;
  const cacheEnabled = cfg.get<boolean>("cache.enabled") ?? true;
  const cacheMax = cfg.get<number>("cache.maxMB") ?? 200;

  const provider = await d.registry.get(providerId);
  d.status.refresh("speaking");

  try {
    // Direct-play providers (native OS TTS) speak through the speakers themselves.
    // No webview, no caching, no audio bytes flow back.
    if (provider.speak) {
      const abort = new AbortController();
      await provider.speak(text, { voice, rate, locale: languageId }, abort.signal);
      return;
    }

    if (!provider.synthesize) {
      throw new Error(`Provider ${provider.id} has no audio output method.`);
    }

    // Streaming providers (cloud) feed audio bytes through the webview player.
    const key = AudioCacheKey(text, providerId, voice, rate);
    if (cacheEnabled) {
      const hit = await d.cache.get(key);
      if (hit) {
        await d.player.play(once(hit), provider.audio.mime);
        return;
      }
    }

    const collected: Uint8Array[] = [];
    const abort = new AbortController();
    const teed = tee(provider.synthesize(text, { voice, rate, locale: languageId }, abort.signal), collected);

    await d.player.play(teed, provider.audio.mime);

    if (cacheEnabled && collected.length) {
      const total = collected.reduce((n, c) => n + c.length, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of collected) { merged.set(c, offset); offset += c.length; }
      await d.cache.put(key, merged);
      void d.cache.evictTo(cacheMax);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Polyvoice: ${(err as Error).message}`);
    d.logger.error((err as Error).stack ?? String(err));
  } finally {
    d.status.refresh("idle");
  }
}

async function selectProvider(d: Deps): Promise<void> {
  const ids = d.registry.ids();
  const picks = await Promise.all(ids.map(async (id) => {
    const p = await d.registry.get(id);
    return { label: p.displayName, description: id, id };
  }));
  const choice = await vscode.window.showQuickPick(picks, { placeHolder: "Pick a TTS provider" });
  if (!choice) return;
  await vscode.workspace.getConfiguration("polyvoice").update("provider", choice.id, vscode.ConfigurationTarget.Global);
  await vscode.workspace.getConfiguration("polyvoice").update("voice", "", vscode.ConfigurationTarget.Global);
  d.status.refresh("idle");
}

async function selectVoice(d: Deps): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("polyvoice");
  const providerId = (cfg.get<string>("provider") || "native") as ProviderId;
  const provider = await d.registry.get(providerId);
  const voices = await provider.listVoices();
  if (voices.length === 0) {
    vscode.window.showInformationMessage(`Polyvoice: no voices reported by ${providerId}.`);
    return;
  }
  const picks = voices.map((v) => ({ label: v.name, description: v.locale ?? "", detail: v.id, id: v.id }));
  const choice = await vscode.window.showQuickPick(picks, { placeHolder: `Pick a voice for ${provider.displayName}` });
  if (!choice) return;
  await cfg.update("voice", choice.id, vscode.ConfigurationTarget.Global);
  d.status.refresh("idle");
}

async function setApiKey(d: Deps, providerId?: ProviderId): Promise<void> {
  let id = providerId;
  if (!id) {
    const ids = d.registry.ids().filter((x) => x !== "native");
    const choice = await vscode.window.showQuickPick(ids, { placeHolder: "Which provider?" });
    if (!choice) return;
    id = choice as ProviderId;
  }
  const value = await vscode.window.showInputBox({
    prompt: `API key for ${id}`,
    password: true,
    ignoreFocusOut: true,
  });
  if (!value) return;
  await d.secrets.set(id, value);
  vscode.window.showInformationMessage(`Polyvoice: ${id} key saved.`);
}

async function exportSelection(d: Deps): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const ex = d.extractFromSelection(editor);
  if (!ex?.text) { vscode.window.showInformationMessage("Polyvoice: nothing selected."); return; }

  const cfg = vscode.workspace.getConfiguration("polyvoice");
  const providerId = (cfg.get<string>("provider") || "native") as ProviderId;
  const voice = cfg.get<string>("voice") || "";
  const rate = cfg.get<number>("rate") ?? 1.0;
  const provider = await d.registry.get(providerId);

  if (!provider.synthesize) {
    vscode.window.showInformationMessage(
      `Polyvoice: ${provider.displayName} plays directly through the OS and can't export to a file. Switch to a cloud provider for export.`,
    );
    return;
  }

  const ext = provider.audio.mime === "audio/mpeg" ? "mp3" : provider.audio.mime === "audio/wav" ? "wav" : "bin";
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`polyvoice-${Date.now()}.${ext}`),
    filters: { Audio: [ext] },
  });
  if (!target) return;

  const abort = new AbortController();
  const chunks: Uint8Array[] = [];
  for await (const chunk of provider.synthesize(ex.text, { voice, rate, locale: ex.languageId }, abort.signal)) {
    chunks.push(chunk);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }
  await fs.writeFile(target.fsPath, merged);
  vscode.window.showInformationMessage(`Polyvoice: wrote ${target.fsPath}`);
}

async function clearCache(d: Deps): Promise<void> {
  await d.cache.clear();
  vscode.window.showInformationMessage("Polyvoice: audio cache cleared.");
}

async function speakClipboard(d: Deps): Promise<void> {
  const text = await vscode.env.clipboard.readText();
  if (!text) { vscode.window.showInformationMessage("Polyvoice: clipboard is empty."); return; }
  await speakRaw(d, text, undefined);
}

async function configureShortcuts(): Promise<void> {
  // Open the Keyboard Shortcuts editor pre-filtered to Polyvoice commands so the
  // user can assign any key they like — no hard-coded default to fight.
  await vscode.commands.executeCommand("workbench.action.openGlobalKeybindings", "polyvoice");
}

async function quickMenu(d: Deps): Promise<void> {
  const items: Array<vscode.QuickPickItem & { cmd: string }> = [
    { label: "$(unmute) Speak Clipboard",           description: "Read whatever is on the clipboard", cmd: "polyvoice.speakClipboard" },
    { label: "$(megaphone) Speak Selection",        description: "Active editor selection",            cmd: "polyvoice.speakSelection" },
    { label: "$(debug-stop) Stop",                  description: "Stop playback",                      cmd: "polyvoice.stop" },
    { label: "$(arrow-swap) Switch Provider",       description: "native, openai, azure, elevenlabs, xai", cmd: "polyvoice.selectProvider" },
    { label: "$(person) Select Voice",              description: "Pick a voice for the current provider", cmd: "polyvoice.selectVoice" },
    { label: "$(keyboard) Configure Shortcuts…",     description: "Assign any key to any Polyvoice command", cmd: "polyvoice.configureShortcuts" },
  ];
  const pick = await vscode.window.showQuickPick(items, { placeHolder: "Polyvoice quick actions" });
  if (!pick) return;
  await vscode.commands.executeCommand(pick.cmd);
  void d; // silence unused
}

async function speakRaw(d: Deps, text: string, languageId: string | undefined): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("polyvoice");
  const providerId = (cfg.get<string>("provider") || "native") as ProviderId;
  const voice = cfg.get<string>("voice") || "";
  const rate = cfg.get<number>("rate") ?? 1.0;
  const provider = await d.registry.get(providerId);
  d.status.refresh("speaking");
  try {
    if (provider.speak) {
      const abort = new AbortController();
      await provider.speak(text, { voice, rate, locale: languageId }, abort.signal);
      return;
    }
    if (!provider.synthesize) throw new Error(`Provider ${provider.id} has no audio output method.`);
    const abort = new AbortController();
    await d.player.play(provider.synthesize(text, { voice, rate, locale: languageId }, abort.signal), provider.audio.mime);
  } catch (err) {
    vscode.window.showErrorMessage(`Polyvoice: ${(err as Error).message}`);
    d.logger.error((err as Error).stack ?? String(err));
  } finally {
    d.status.refresh("idle");
  }
}

// Grab the current selection from anywhere in VS Code (Extensions view, Copilot
// Chat, Welcome page, Markdown preview, settings UI, terminal, etc.).
// Strategy:
//   1. Snapshot the current clipboard.
//   2. Clear it and try the universal `editor.action.clipboardCopyAction` — this
//      works in editors and a handful of other native surfaces.
//   3. If something new landed on the clipboard, use it and restore the snapshot.
//   4. Otherwise (webview surfaces like Extensions / Copilot Chat where the copy
//      command is a no-op), fall back to whatever the user had on the clipboard
//      already — typical workflow there is: select text → Ctrl+C → Ctrl+Alt+S.
async function grabSelectionViaClipboard(logger: Logger): Promise<string | undefined> {
  let saved = "";
  try { saved = await vscode.env.clipboard.readText(); } catch { /* clipboard may be empty */ }
  let restore = true;
  try {
    await vscode.env.clipboard.writeText("");
    try { await vscode.commands.executeCommand("editor.action.clipboardCopyAction"); } catch { /* no-op in webviews */ }
    await new Promise((r) => setTimeout(r, 80));
    const grabbed = await vscode.env.clipboard.readText();
    if (grabbed && grabbed.length > 0) return grabbed;
    // Copy command produced nothing — webview surface. Use the pre-existing clipboard
    // (the user pressed Ctrl+C first) and don't clobber it on the way out.
    if (saved && saved.length > 0) { restore = false; return saved; }
    return undefined;
  } catch (err) {
    logger.warn(`clipboard-copy fallback failed: ${(err as Error).message}`);
    return saved || undefined;
  } finally {
    if (restore) {
      try { await vscode.env.clipboard.writeText(saved); } catch { /* ignore */ }
    }
  }
}

// ---------- helpers ----------

function AudioCacheKey(text: string, providerId: string, voice: string, rate: number): string {
  // Re-exporting cache.key inline keeps commands free of cache internals.
  const { AudioCache } = require("../cache");
  return AudioCache.key({ text, providerId, voice, rate });
}

async function* once(buf: Uint8Array): AsyncIterable<Uint8Array> { yield buf; }

async function* tee(src: AsyncIterable<Uint8Array>, sink: Uint8Array[]): AsyncIterable<Uint8Array> {
  for await (const chunk of src) {
    sink.push(chunk);
    yield chunk;
  }
}
