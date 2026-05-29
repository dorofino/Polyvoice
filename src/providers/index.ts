// Provider registry. Lazy-instantiates each backend on first request
// to keep extension activation fast (< 50 ms).

import type { TtsProvider } from "./types";
import type { SecretsManager } from "../util/secrets";
import type { Logger } from "../util/logger";

export type ProviderId = "native" | "openai" | "azure" | "elevenlabs" | "xai";

type Factory = () => Promise<TtsProvider>;

export class ProviderRegistry {
  private readonly factories: Record<ProviderId, Factory>;
  private readonly instances = new Map<ProviderId, TtsProvider>();

  constructor(
    private readonly secrets: SecretsManager,
    private readonly logger: Logger,
  ) {
    this.factories = {
      native:     async () => new (await import("./native")).NativeProvider(this.logger),
      openai:     async () => new (await import("./openai")).OpenAIProvider(this.secrets, this.logger),
      azure:      async () => new (await import("./azure")).AzureProvider(this.secrets, this.logger),
      elevenlabs: async () => new (await import("./elevenlabs")).ElevenLabsProvider(this.secrets, this.logger),
      xai:        async () => new (await import("./xai")).XaiProvider(this.secrets, this.logger),
    };
  }

  async get(id: ProviderId): Promise<TtsProvider> {
    const existing = this.instances.get(id);
    if (existing) return existing;
    const factory = this.factories[id];
    if (!factory) throw new Error(`Unknown provider: ${id}`);
    const instance = await factory();
    this.instances.set(id, instance);
    return instance;
  }

  ids(): ProviderId[] {
    return Object.keys(this.factories) as ProviderId[];
  }
}
