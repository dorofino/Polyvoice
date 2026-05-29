# Adding a new TTS provider

A provider is one TypeScript file under `src/providers/`. It implements the `TtsProvider` interface and gets registered in `src/providers/index.ts`.

## Skeleton

```ts
// src/providers/myprovider.ts
import type { TtsProvider, Voice, SynthesizeOptions } from "./types";
import { ProviderError } from "./types";
import type { SecretsManager } from "../util/secrets";
import type { Logger } from "../util/logger";

export class MyProvider implements TtsProvider {
  readonly id = "myprovider";
  readonly displayName = "My Provider";
  readonly needsApiKey = true;
  readonly audio = { mime: "audio/mpeg" as const };

  constructor(private secrets: SecretsManager, private logger: Logger) {}

  async listVoices(): Promise<Voice[]> { /* ... */ return []; }

  async *synthesize(text: string, opts: SynthesizeOptions, signal: AbortSignal): AsyncIterable<Uint8Array> {
    const key = await this.secrets.require(this.id);
    const res = await fetch("https://api.example.com/tts", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ text, voice: opts.voice }),
      signal,
    });
    if (!res.ok || !res.body) throw new ProviderError(`status ${res.status}`, this.id, res.status);
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  }
}
```

## Register it

Edit `src/providers/index.ts`:

```ts
myprovider: async () => new (await import("./myprovider")).MyProvider(this.secrets, this.logger),
```

## Wire it into settings

Add the id to the `enum` and `enumDescriptions` of `polyvoice.provider` in `package.json`.

## Stream chunks, don't buffer

The core feeds chunks straight into a `MediaSource` in the webview, so playback starts on the first chunk. If your API only returns a full file, that's still fine — just yield it as one chunk. But streaming wins on perceived latency every time.

## MIME tag

Set `audio.mime` correctly — `audio/mpeg`, `audio/wav`, or `audio/ogg`. The player passes this verbatim to `MediaSource.addSourceBuffer`.
