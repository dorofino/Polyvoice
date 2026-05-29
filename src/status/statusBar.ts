// Status-bar UI. Shows the active provider and voice, and acts as a quick toggle.
// Click → opens the provider picker. Right-click is not supported by VS Code status items;
// we rely on the command palette and editor context menu for everything else.

import * as vscode from "vscode";

export class StatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "polyvoice.quickMenu";
    this.item.show();
  }

  refresh(state?: "idle" | "speaking" | "paused"): void {
    const cfg = vscode.workspace.getConfiguration("polyvoice");
    const provider = cfg.get<string>("provider") || "native";
    const voice = cfg.get<string>("voice") || "default";
    const icon = state === "speaking" ? "$(unmute)"
               : state === "paused"   ? "$(debug-pause)"
               :                        "$(megaphone)";
    this.item.text = `${icon} Polyvoice: ${provider} · ${voice}`;
    this.item.tooltip = `Polyvoice — provider: ${provider}, voice: ${voice}. Click for quick actions.`;
  }

  dispose(): void {
    this.item.dispose();
  }
}
