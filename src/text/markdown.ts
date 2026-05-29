// Tiny markdown cleaner. Not a real parser — good enough to skip the obviously-noisy bits
// (fenced code, HTML comments, raw URLs, image alt syntax) before sending to TTS.

export interface CleanOptions {
  skipCodeBlocks: boolean;
  skipLinks: boolean;
}

export function cleanMarkdown(input: string, opts: CleanOptions): string {
  let out = input;

  // Strip HTML comments.
  out = out.replace(/<!--[\s\S]*?-->/g, "");

  // Strip fenced code blocks.
  if (opts.skipCodeBlocks) {
    out = out.replace(/```[\s\S]*?```/g, " [code block] ");
    out = out.replace(/`[^`\n]+`/g, "");
  }

  // Collapse links: keep visible text, drop URL.
  if (opts.skipLinks) {
    out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");     // images → nothing
    out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");   // [text](url) → text
    out = out.replace(/<https?:\/\/[^>]+>/g, "");
  }

  // Headings, list markers, blockquote chevrons.
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  out = out.replace(/^\s*[-*+]\s+/gm, "");
  out = out.replace(/^\s*\d+\.\s+/gm, "");
  out = out.replace(/^\s*>\s?/gm, "");

  // Emphasis markers.
  out = out.replace(/(\*\*|__)(.*?)\1/g, "$2");
  out = out.replace(/(\*|_)(.*?)\1/g, "$2");

  // Collapse extra whitespace.
  out = out.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");

  return out;
}
