// Pulls text out of the editor and optionally cleans it before synthesis.

import * as vscode from "vscode";
import { cleanMarkdown } from "./markdown";

export interface Extraction {
  text: string;
  locale?: string;
  languageId?: string;
}

export function extractFromSelection(editor: vscode.TextEditor): Extraction | undefined {
  const sel = editor.selection;
  if (sel.isEmpty) return undefined;
  return finalize(editor.document.getText(sel), editor.document);
}

export function extractFromDocument(editor: vscode.TextEditor): Extraction | undefined {
  return finalize(editor.document.getText(), editor.document);
}

function finalize(raw: string, doc: vscode.TextDocument): Extraction {
  const cfg = vscode.workspace.getConfiguration("polyvoice");
  const skipCode = cfg.get<boolean>("markdown.skipCodeBlocks") ?? true;
  const skipLinks = cfg.get<boolean>("markdown.skipLinks") ?? false;

  const cleaned = doc.languageId === "markdown"
    ? cleanMarkdown(raw, { skipCodeBlocks: skipCode, skipLinks })
    : raw;

  return {
    text: cleaned.trim(),
    languageId: doc.languageId,
  };
}
